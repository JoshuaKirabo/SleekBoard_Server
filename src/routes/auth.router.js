import { Router } from "express";

// Sign-in's routes around any AuthController. auth.route.js mounts the server's own; tests build theirs with a stand-in
// Google, which is why this file doesn't touch the database wiring.
export const authRoutes = (controller) =>
  {
    const router = Router();
    router.get("/google", (req, res, next) => controller.startGoogle(req, res, next));
    router.get("/google/callback", (req, res, next) => controller.finishGoogle(req, res, next));
    router.post("/logout", (req, res, next) => controller.signOut(req, res, next));
    router.get("/me", (req, res) => controller.me(req, res));
    return router;
  };
