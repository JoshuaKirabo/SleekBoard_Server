import { CurrentUser } from "./CurrentUser.js";

// Whose data each request and each background run works on. Sign-in sets it per request (middleware/requireUser.js).
export const currentUser = new CurrentUser();
