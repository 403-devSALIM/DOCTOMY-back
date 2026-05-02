import express from "express";
import multer from "multer";
import cloudinary from "../lib/cloudinary.js";
import prisma from "../lib/prisma.js";
import axios from "axios";
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
  upload.fields([
    { name: "personImage", maxCount: 1 },
    { name: "identityCard", maxCount: 1 },
    { name: "nif", maxCount: 1 },
    { name: "workAuth", maxCount: 1 },
    { name: "birthCert", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const { fullName, identifiers } = req.body;
      const files = req.files;

      if (!files || Object.keys(files).length < 5) {
        return res.status(400).json({ message: "All 5 documents are required" });
      }

      // 1. Upload all files to Cloudinary
      const uploadPromises = Object.keys(files).map((key) => {
        const file = files[key][0];
        return new Promise((resolve, reject) => {
          const uploadStream = cloudinary.uploader.upload_stream(
            {
              folder: `user_${req.user.id}/verification`,
              resource_type: "auto",
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
        // We continue even if webhook fails, but we might want to log it
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
 * @desc    Compare person image and ID card image for identity verification
 * @access  Private
 */
router.post(
  "/compare",
  protectRoute,
  upload.fields([
    { name: "personImage", maxCount: 1 },
    { name: "identityCard", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const files = req.files;
      if (!files || !files.personImage || !files.identityCard) {
        return res.status(400).json({ message: "Both personImage and identityCard are required" });
      }

      // NOTE: Real face comparison requires a specialized library (like face-api.js) 
      // or an external AI service (AWS Rekognition, Azure Face API, etc.)
      
      // For this implementation, I will provide the structural logic.
      // If you have a specific AI service, you would call it here.
      
      // MOCK COMPARISON LOGIC (Replace with real AI call)
      console.log("Performing face comparison...");
      
      // Placeholder for AI comparison result
      // In a real scenario, you would send the buffers to an AI service
      const matchScore = Math.random() * 100; // Mock score
      const isMatch = matchScore > 70; // Mock threshold

      res.status(200).json({
        message: "Identity verification completed",
        match: isMatch,
        confidence: matchScore.toFixed(2) + "%",
        note: "This is a mock result. For real production, integrate an AI service like AWS Rekognition or face-api.js."
      });
    } catch (error) {
      console.error("Identity verification error:", error);
      res.status(500).json({ message: "Failed to verify identity" });
    }
  }
);

export default router;
