import express from "express";
import prisma from "../lib/prisma.js";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

const router = express.Router();

const generateToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: "15d" });
};

// Register route
router.post("/register", async (req, res) => {
  try {
    const {
      accountType,
      firstName,
      lastName,
      phoneNumber,
      dateOfBirth,
      email,
      wilaya,
      commune,
      password,
      confirmPassword,
      gender,
      acceptTerms,
      username
    } = req.body;

    if (!firstName || !phoneNumber || !email || !wilaya || !password) {
      return res.status(400).json({ message: "Les champs obligatoires doivent être remplis." });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ message: "Les mots de passe ne correspondent pas." });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: "Le mot de passe doit comporter au moins 6 caractères." });
    }

    // Check if user accepted terms (the form sends a boolean or a string)
    if (acceptTerms !== true && acceptTerms !== "true" && acceptTerms !== "on") {
      return res.status(400).json({ message: "Vous devez accepter la Confidentialité et les Conditions d'utilisation." });
    }

    // check if user already exists (by email or username)
    let whereCondition = { email: email };
    if (username) {
      whereCondition = { OR: [{ email: email }, { username: username }] };
    }

    const existingUser = await prisma.user.findFirst({
      where: whereCondition
    });

    if (existingUser) {
      if (existingUser.email === email) {
        return res.status(400).json({ message: "Cet e-mail existe déjà." });
      }
      if (username && existingUser.username === username) {
        return res.status(400).json({ message: "Ce nom d'utilisateur existe déjà." });
      }
    }

    // hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // get random avatar (using firstName as seed since username might be empty)
    const seed = username || firstName;
    const profileImage = `https://api.dicebear.com/7.x/avataaars/svg?seed=${seed}`;

    const user = await prisma.user.create({
      data: {
        email,
        username: username || null,
        password: hashedPassword,
        profileImage,
        firstName,
        lastName,
        phoneNumber,
        dateOfBirth,
        wilaya,
        commune,
        gender,
        accountType
      },
    });

    // generate token
    const token = generateToken(user.id);

    res.status(201).json({
      token,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        profileImage: user.profileImage,
        role: user.role,
      },
    });
  } catch (error) {
    console.log("Error in register route:", error);
    res.status(500).json({
      message: "Server error",
    });
  }
});

// Login route
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "All fields are required" });
    }

    // check if user exists
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    // check password
    const isPasswordCorrect = await bcrypt.compare(password, user.password);
    if (!isPasswordCorrect) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    // generate token
    const token = generateToken(user.id);

    res.status(200).json({
      token,
      user: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        profileImage: user.profileImage,
        role: user.role,
      },
    });
  } catch (error) {
    console.log("Error in login route:", error);
    res.status(500).json({ message: "Server error" });
  }
});

export default router;
