import protectRoute from "./autmiddlware.js";

const adminRoute = async (req, res, next) => {
  // First run protectRoute to verify token and set req.user
  await protectRoute(req, res, () => {
    // Check if user is an admin
    if (req.user && req.user.role === "ADMIN") {
      next();
    } else {
      res.status(403).json({ message: "Access denied. Admin only." });
    }
  });
};

export default adminRoute;
