import express from "express";
import multer from "multer";
import cloudinary from "../lib/cloudinary.js";
import prisma from "../lib/prisma.js";
import axios from "axios";
import FormData from "form-data";
import protectRoute from "../middleware/autmiddlware.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

/**
 * @route   POST /api/verify/submit
 * @desc    Submit identity documents and send to webhook
 * @access  Private
 */
router.post(
  "/submit",
  protectRoute,
  upload.any(),
  async (req, res) => {
    try {
      const { fullName, identifiers } = req.body;
      const files = req.files || [];

      // Required fields list
      const requiredFields = ["personImage", "identityCard", "nif", "workAuth", "birthCert"];
      
      // Filter the files we actually need
      const filteredFiles = files.filter(file => requiredFields.includes(file.fieldname));

      if (filteredFiles.length < 5) {
        return res.status(400).json({ 
          message: "All 5 documents are required", 
          missing: requiredFields.filter(field => !files.some(f => f.fieldname === field))
        });
      }

      // 1. Upload all files to Cloudinary
      const uploadPromises = filteredFiles.map((file) => {
        const key = file.fieldname;
        return new Promise((resolve, reject) => {
          const uploadStream = cloudinary.uploader.upload_stream(
            {
              folder: `user_${req.user.id}/verification`,
              resource_type: "auto",
              type: "upload", // Make it public
            },
            (error, result) => {
              if (error) reject(error);
              else resolve({ type: key, url: result.secure_url, publicId: result.public_id });
            }
          );
          uploadStream.end(file.buffer);
        });
      });

      const uploadResults = await Promise.all(uploadPromises);

      // 2. Save documents and update user status to in_progress
      await prisma.user.update({
        where: { id: req.user.id },
        data: { status: "in_progress" },
      });

      const savedDocs = await Promise.all(
        uploadResults.map((doc) =>
          prisma.document.create({
            data: {
              url: doc.url,
              publicId: doc.publicId,
              type: doc.type,
              userId: req.user.id,
              originalName: doc.type, // Using type as name for reference
            },
          })
        )
      );

      // 3. Prepare data for webhook
      const webhookData = {
        userId: req.user.id,
        fullName,
        identifiers,
        documents: uploadResults.reduce((acc, curr) => {
          acc[curr.type] = curr.url;
          return acc;
        }, {}),
        submittedAt: new Date(),
      };

      // 4. Send to webhook
      try {
        await axios.post("https://n8n.okba-bouhadjar.me/webhook/documents", webhookData);
        console.log("✅ Data successfully sent to n8n webhook");
      } catch (webhookError) {
        console.error("❌ Webhook error:", webhookError.message);
      }

      res.status(200).json({
        message: "Documents submitted successfully",
        documents: savedDocs,
      });
    } catch (error) {
      console.error("Verification submit error:", error);
      res.status(500).json({ message: "Failed to submit documents" });
    }
  }
);

/**
 * @route   POST /api/verify/compare
 * @desc    Compare person image and ID card image using Luxand.cloud API
 * @access  Private
 */
router.post(
  "/compare",
  protectRoute,
  upload.any(),
  async (req, res) => {
    try {
      const files = req.files || [];
      const personImageFile = files.find(f => f.fieldname === "personImage");
      const identityCardFile = files.find(f => f.fieldname === "identityCard");

      if (!personImageFile || !identityCardFile) {
        return res.status(400).json({ message: "Both personImage and identityCard are required" });
      }

      console.log("Performing improved face comparison via Cloudinary + Luxand...");

      // Helper function to upload with automatic orientation fix
      const uploadToTemp = (file) => {
        return new Promise((resolve, reject) => {
          const uploadStream = cloudinary.uploader.upload_stream(
            { 
              folder: "temp_comparison", 
              resource_type: "image",
              angle: "auto" // Automatically fix rotated images (EXIF orientation)
            },
            (error, result) => {
              if (error) reject(error);
              else resolve(result.secure_url);
            }
          );
          uploadStream.end(file.buffer);
        });
      };

      // 1. Upload both with auto-rotation fix
      const [url1, url2] = await Promise.all([
        uploadToTemp(personImageFile),
        uploadToTemp(identityCardFile)
      ]);

      console.log("Images optimized and rotated. Sending to Luxand...");

      // 2. Prepare form data for Luxand API using URLs
      const form = new FormData();
      // Luxand supports face1/face2 or photo1/photo2 depending on version
      // We will use face1/face2 which is standard for the latest Similarity API
      form.append("face1", url1);
      form.append("face2", url2);

      // Use your Luxand API Key
      const LUXAND_API_KEY = process.env.LUXAND_API_KEY || "YOUR_LUXAND_API_KEY";

      if (!LUXAND_API_KEY || LUXAND_API_KEY === "YOUR_LUXAND_API_KEY") {
         return res.status(500).json({ message: "Identity verification API not configured." });
      }

      const response = await axios.post("https://api.luxand.cloud/photo/similarity", form, {
        headers: {
          ...form.getHeaders(),
          "token": LUXAND_API_KEY
        }
      });

      // Luxand returns a similarity score (0 to 1)
      const similarity = response.data.similarity || 0;
      const threshold = 0.6; // Slightly lowered threshold for better matching on IDs
      const isMatch = similarity > threshold;
      const confidence = (similarity * 100).toFixed(2);

      // Extract Luxand's specific error if it failed
      const luxandMessage = response.data.message || (isMatch ? "Faces match" : "Faces do not match");

      res.status(200).json({
        message: "Identity verification completed",
        match: isMatch,
        confidence: confidence + "%",
        status: response.data.status,
        details: luxandMessage,
        note: isMatch ? "Success: Identity verified." : "Warning: Faces do not appear to match or weren't detected clearly."
      });

    } catch (error) {
      console.error("Identity verification error:", error.response?.data || error.message);
      res.status(500).json({ 
        message: "Failed to verify identity via external service",
        error: error.response?.data?.message || error.message
      });
    }
  }
);

/**
 * @route   POST /api/verify/webhook-callback
 * @desc    Callback endpoint for n8n to update verification results
 * @access  Public (Should use a secret in production)
 */
router.post("/webhook-callback", async (req, res) => {
  try {
    const { userId, is_valid, is_nif_valid, validity_percentage, report, status } = req.body;

    if (!userId) {
      return res.status(400).json({ message: "userId is required" });
    }

    // Update user with verification data from n8n
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        isValid: is_valid !== undefined ? is_valid : false,
        isNifValid: is_nif_valid !== undefined ? is_nif_valid : false,
        validityPercentage: validity_percentage !== undefined ? parseInt(validity_percentage) : 0,
        report: report || "",
        status: status || (is_valid ? "accepted" : "rejected"), // Auto-update status based on validity if status not provided
      },
    });

    console.log(`✅ User ${userId} verification updated from n8n`);
    res.status(200).json({ message: "User verification updated successfully", userId: updatedUser.id });
  } catch (error) {
    console.error("Webhook callback error:", error);
    res.status(500).json({ message: "Failed to update verification data" });
  }
});

export default router;
