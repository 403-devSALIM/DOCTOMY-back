import path from "path";
import express from "express";
import multer from "multer";
import cloudinary from "../lib/cloudinary.js";
import prisma from "../lib/prisma.js";
import axios from "axios";
import protectRoute from "../middleware/autmiddlware.js";
import * as faceapi from "@vladmandic/face-api";
import canvas from "canvas";

const { Canvas, Image, ImageData } = canvas;
faceapi.env.monkeyPatch({ Canvas, Image, ImageData });

// Load models on startup
const modelsPath = path.join(process.cwd(), "src", "models");
let modelsLoaded = false;

const loadModels = async () => {
  try {
    await faceapi.nets.tinyFaceDetector.loadFromDisk(modelsPath);
    await faceapi.nets.faceLandmark68Net.loadFromDisk(modelsPath);
    await faceapi.nets.faceRecognitionNet.loadFromDisk(modelsPath);
    modelsLoaded = true;
    console.log("✅ FaceAPI models loaded successfully");
  } catch (error) {
    console.error("❌ Failed to load FaceAPI models:", error.message);
  }
};
loadModels();

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// Helper to get face descriptors from image buffer
async function getDescriptor(buffer) {
  const img = await canvas.loadImage(buffer);
  const detections = await faceapi
    .detectSingleFace(img, new faceapi.TinyFaceDetectorOptions())
    .withFaceLandmarks()
    .withFaceDescriptor();
  return detections ? detections.descriptor : null;
}

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
  upload.any(),
  async (req, res) => {
    try {
      if (!modelsLoaded) {
        return res.status(503).json({ message: "Face verification models are still loading. Please try again in a moment." });
      }

      const files = req.files || [];
      const personImageFile = files.find(f => f.fieldname === "personImage");
      const identityCardFile = files.find(f => f.fieldname === "identityCard");

      if (!personImageFile || !identityCardFile) {
        return res.status(400).json({ message: "Both personImage and identityCard are required" });
      }

      console.log("Performing real face comparison...");

      // Get descriptors for both images
      const descriptor1 = await getDescriptor(personImageFile.buffer);
      const descriptor2 = await getDescriptor(identityCardFile.buffer);

      if (!descriptor1 || !descriptor2) {
        return res.status(400).json({ 
          message: "Could not detect a clear face in one or both images.",
          personImageFound: !!descriptor1,
          identityCardFound: !!descriptor2
        });
      }

      // Calculate Euclidean distance between descriptors
      // 0 = identical, 1 = completely different. Threshold is usually 0.6
      const distance = faceapi.euclideanDistance(descriptor1, descriptor2);
      const threshold = 0.6;
      const isMatch = distance < threshold;
      
      // Calculate confidence (inverse of distance, capped at 100%)
      const confidence = Math.max(0, Math.min(100, (1 - distance) * 100));

      res.status(200).json({
        message: "Identity verification completed",
        match: isMatch,
        confidence: confidence.toFixed(2) + "%",
        distance: distance.toFixed(4),
        note: isMatch ? "Faces match correctly." : "Faces do not appear to match."
      });
    } catch (error) {
      console.error("Identity verification error:", error);
      res.status(500).json({ message: "Failed to verify identity" });
    }
  }
);

export default router;
