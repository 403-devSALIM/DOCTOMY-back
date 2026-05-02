import express from "express";
import multer from "multer";
import cloudinary from "../lib/cloudinary.js";
import protectRoute from "../middleware/autmiddlware.js";
import prisma from "../lib/prisma.js";

const router = express.Router();

// Configure multer (memory storage)
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
    if (!process.env.CLOUDINARY_CLOUD_NAME || process.env.CLOUDINARY_CLOUD_NAME === "your_cloud_name") {
      return res.status(500).json({ message: "Cloudinary is not configured." });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ message: "No files uploaded." });
    }

    const uploadPromises = req.files.map((file) => {
      return new Promise((resolve, reject) => {
        // Explicitly detect if it is a PDF
        const isPdf = 
          file.originalname.toLowerCase().endsWith('.pdf') || 
          file.mimetype === 'application/pdf';

        let fileExt = file.originalname.split('.').pop().toLowerCase();
        if (fileExt === 'jpeg') fileExt = 'jpg';
        
        const format = isPdf ? 'pdf' : (fileExt || 'jpg');

        const cloudinaryOptions = {
          folder: `user_${req.user.id}/documents`,
          resource_type: "auto",
          type: "upload",
          access_mode: "public",
          format: format, // ✅ Force Cloudinary to save with this exact extension
          use_filename: true,
          unique_filename: true
        };

        if (!isPdf) {
          cloudinaryOptions.angle = "auto";
        }

        const uploadStream = cloudinary.uploader.upload_stream(
          cloudinaryOptions,
          (error, result) => {
            if (error) reject(error);
            else resolve({
              url: result.secure_url,
              publicId: result.public_id,
              format: result.format || format,
              originalName: file.originalname
            });
          }
        );
        uploadStream.end(file.buffer);
      });
    });

    const uploadResults = await Promise.all(uploadPromises);

    const savedDocuments = await Promise.all(
      uploadResults.map((doc) =>
        prisma.document.create({
          data: {
            url: doc.url,
            publicId: doc.publicId,
            format: doc.format, // ✅ Added format here to save in DB
            originalName: doc.originalName,
            userId: req.user.id,
          },
        })
      )
    );

    res.status(200).json({ message: "Files uploaded successfully", files: savedDocuments });
  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).json({ message: "Failed to upload files" });
  }
});

/**
 * @route   POST /api/upload/single
 * @desc    Upload a single image
 * @access  Private
 */
router.post("/single", protectRoute, upload.single("image"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });

    const result = await new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: "profile_images",
          resource_type: "image",
          type: "upload",
          access_mode: "public",
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
 * @desc    Get all documents for user
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
    res.status(500).json({ message: "Failed to fetch documents" });
  }
});

export default router;
