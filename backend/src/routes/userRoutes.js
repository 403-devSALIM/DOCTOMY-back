import express from "express";
import prisma from "../lib/prisma.js";
import adminRoute from "../middleware/adminMiddleware.js";
import protectRoute from "../middleware/autmiddlware.js";

const router = express.Router();

// Get profile of authenticated user
router.get("/profile", protectRoute, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        email: true,
        username: true,
        firstName: true,
        lastName: true,
        phoneNumber: true,
        accountType: true,
        wilaya: true,
        commune: true,
        gender: true,
        role: true,
        status: true,
        isValid: true,
        isNifValid: true,
        validityPercentage: true,
        report: true,
        profileImage: true,
        createdAt: true,
      },
    });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.status(200).json(user);
  } catch (error) {
    console.error("Error fetching profile:", error.message);
    res.status(500).json({ message: "Server error" });
  }
});

// Fetch all users (Admin only)
router.get("/", adminRoute, async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phoneNumber: true,
        accountType: true,
        wilaya: true,
        commune: true,
        gender: true,
        role: true,
        status: true,
        isValid: true,
        isNifValid: true,
        validityPercentage: true,
        report: true,
        createdAt: true,
      },
      where: {
        role: "USER"
      }
    });

    res.status(200).json(users);
  } catch (error) {
    console.error("Error fetching users:", error.message);
    res.status(500).json({ message: "Server error" });
  }
});

// Update user status (Admin only)
router.patch("/:id/status", adminRoute, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const allowedStatuses = ["rejected", "in_progress", "not_complete", "accepted", "needs_update"];
    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ message: "Invalid status value" });
    }

    const updatedUser = await prisma.user.update({
      where: { id },
      data: { status },
      select: {
        id: true,
        email: true,
        status: true,
      },
    });

    res.status(200).json({ message: "User status updated successfully", user: updatedUser });
  } catch (error) {
    console.error("Error updating user status:", error.message);
    res.status(500).json({ message: "Server error" });
  }
});

// Delete user by ID (Admin only)
router.delete("/:id", adminRoute, async (req, res) => {
  try {
    const { id } = req.params;

    // Optional: Prevent admin from deleting themselves
    if (req.user.id === id) {
      return res.status(400).json({ message: "You cannot delete your own admin account." });
    }

    const user = await prisma.user.findUnique({
      where: { id },
    });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    await prisma.user.delete({
      where: { id },
    });

    res.status(200).json({ message: "User deleted successfully" });
  } catch (error) {
    console.error("Error deleting user:", error.message);
    res.status(500).json({ message: "Server error" });
  }
});

export default router;
