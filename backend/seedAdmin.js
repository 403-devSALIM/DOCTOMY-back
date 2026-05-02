import prisma from "./src/lib/prisma.js";
import bcrypt from "bcryptjs";

async function main() {
  const email = "doctome@gmail.com";
  const password = "doctome123";

  // Check if admin already exists
  const existingAdmin = await prisma.user.findUnique({
    where: { email }
  });

  if (existingAdmin) {
    console.log("Admin account already exists.");
    return;
  }

  // Hash password
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(password, salt);

  // Create admin user
  await prisma.user.create({
    data: {
      email,
      password: hashedPassword,
      firstName: "Admin",
      lastName: "Doctome",
      phoneNumber: "0000000000",
      wilaya: "Admin",
      role: "ADMIN",
      accountType: "Admin",
      profileImage: "https://api.dicebear.com/7.x/avataaars/svg?seed=admin"
    }
  });

  console.log("Admin account created successfully!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
