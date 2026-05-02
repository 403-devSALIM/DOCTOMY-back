import express from "express";
import multer from "multer";
import cloudinary from "../lib/cloudinary.js";
import protectRoute from "../middleware/autmiddlware.js";
import prisma from "../lib/prisma.js";

const router = express.Router();

// Configure multer (memory storage)
// This will keep files in memory before uploading to Cloudinary
const storage = multer.memoryStorage();
const upload = multer({ 
  storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit per file
});

/**
 * @route   POST /api/upload/documents
 * @desc    Upload multiple documents (up to 5) to Cloudinary
 * @access  Private
 */
router.post("/documents", protectRoute, upload.array("documents", 5), async (req, res) => {
  try {
    // Check if Cloudinary is configured
    if (!process.env.CLOUDINARY_CLOUD_NAME || process.env.CLOUDINARY_CLOUD_NAME === "your_cloud_name") {
      return res.status(500).json({ message: "Cloudinary is not configured. Please check your .env file." });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ message: "No files uploaded. Make sure you use the key 'documents' in form-data." });
    }

    // Upload each file to Cloudinary
    const uploadPromises = req.files.map((file) => {
      return new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          {
            // Organize files by user ID for security and better management
            folder: `user_${req.user.id}/documents`,
            resource_type: "auto",
          },
          (error, result) => {
            if (error) {
              console.error("Cloudinary upload error:", error);
              reject(error);
            } else {
              resolve({
                url: result.secure_url,
                publicId: result.public_id,
                format: result.format,
                originalName: file.originalname
              });
            }
          }
        );
        uploadStream.end(file.buffer);
      });
    });

    const uploadResults = await Promise.all(uploadPromises);

    // Save each document reference to the database
    const savedDocuments = await Promise.all(
      uploadResults.map((doc) =>
        prisma.document.create({
          data: {
            url: doc.url,
            publicId: doc.publicId,
            format: doc.format,
            originalName: doc.originalName,
            userId: req.user.id, // Associate with the authenticated user
          },
        })
      )
    );

    res.status(200).json({
      message: "Files uploaded and saved successfully",
      files: savedDocuments,
    });
  } catch (error) {
    console.error("Upload process error:", error);
    res.status(500).json({ message: "Failed to upload files to Cloudinary" });
  }
});

/**
 * @route   POST /api/upload/single
 * @desc    Upload a single image (e.g. profile picture)
 * @access  Private
 */
router.post("/single", protectRoute, upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    const result = await new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: "profile_images",
          resource_type: "image",
        },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        }
      );
      uploadStream.end(req.file.buffer);
    });

    res.status(200).json({
      message: "Image uploaded successfully",
      url: result.secure_url,
      public_id: result.public_id
    });
  } catch (error) {
    console.error("Single upload error:", error);
    res.status(500).json({ message: "Failed to upload image" });
  }
});

/**
 * @route   GET /api/upload/my-documents
 * @desc    Get all documents belonging to the authenticated user
 * @access  Private
 */
router.get("/my-documents", protectRoute, async (req, res) => {
  try {
    const documents = await prisma.document.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: "desc" },
    });

    res.status(200).json(documents);
  } catch (error) {
    console.error("Fetch documents error:", error);
    res.status(500).json({ message: "Failed to fetch documents" });
  }
});

export default router;
