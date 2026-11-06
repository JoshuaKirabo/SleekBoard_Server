import { authRoutes } from "./auth.router.js";
import { AuthController } from "../controllers/auth.controller.js";
import { passport, authSettings, loginLimits } from "../services/auth/index.js";

// Sign-in's routes, on the server's own passport, settings and failed-try counts.
export default authRoutes(new AuthController({ passport, settings: authSettings, limits: loginLimits }));
