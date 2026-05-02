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

      // 2. Save to database
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

      console.log("Performing face comparison via Luxand API...");

      // Prepare form data for Luxand API
      const form = new FormData();
      form.append("face1", personImageFile.buffer, { filename: "person.jpg" });
      form.append("face2", identityCardFile.buffer, { filename: "card.jpg" });

      // Use your Luxand API Key (Get one for free at luxand.cloud)
      const LUXAND_API_KEY = process.env.LUXAND_API_KEY || "YOUR_LUXAND_API_KEY";

      if (!LUXAND_API_KEY || LUXAND_API_KEY === "YOUR_LUXAND_API_KEY") {
         return res.status(500).json({ 
           message: "Identity verification API not configured.",
           note: "Please add LUXAND_API_KEY to your .env file in Render." 
         });
      }

      const response = await axios.post("https://api.luxand.cloud/photo/similarity", form, {
        headers: {
          ...form.getHeaders(),
          "token": LUXAND_API_KEY
        }
      });

      // Luxand /photo/similarity returns a "similarity" score (0 to 1)
      const similarity = response.data.similarity || 0;
      const threshold = 0.7; // Luxand recommendation for matching
      const isMatch = similarity > threshold;
      const confidence = (similarity * 100).toFixed(2);

      res.status(200).json({
        message: "Identity verification completed",
        match: isMatch,
        confidence: confidence + "%",
        provider: "Luxand.cloud",
        raw: response.data
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

export default router;
