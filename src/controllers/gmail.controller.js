import { StatusCodes } from "http-status-codes";
import { gmailConnect, gmailTokens, gmailRedirect, boardUrl } from "../agent/container.js";

// Connect Gmail's routes, after JobNavigator's api/routes_gmail.py. Connect is a plain link the board opens, so it
// sends you straight to Google instead of answering with JSON. Google's answer comes back to callback, which sends you
// back to the board with ?gmail=connected or ?gmail=error&reason=….

// The cookie holding the state's nonce. Only the callback sees it. Lax because Google's redirect back is a top-level
// GET from another site, which a Strict cookie wouldn't ride along on.
const COOKIE = "sb_gmail_state";
const COOKIE_PATH = "/api/gmail/callback";
const cookieOptions = () => ({ path: COOKIE_PATH, httpOnly: true, sameSite: "lax", secure: gmailRedirect.startsWith("https://") });

// One cookie off the request. Express doesn't read cookies on its own.
const cookieOf = (req, name) =>
  {
    const pair = String(req.headers.cookie || "").split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
    return pair ? decodeURIComponent(pair.slice(name.length + 1)) : "";
  };

// The board with Gmail's answer on it.
const backToBoard = (answer) =>
  {
    const params = new URLSearchParams(answer.ok ? { gmail: "connected" } : { gmail: "error", reason: answer.reason });
    return `${boardUrl}?${params}`;
  };

// GET /api/gmail/status. { status: connected | none | expired, configured, address }.
export const gmailStatus = async (req, res) =>
  {
    res.json(await gmailTokens.status());
  };

// GET /api/gmail/connect. Off to Google's consent screen, with this browser holding the nonce for 10 minutes.
export const connectGmail = (req, res) =>
  {
    const { url, nonce } = gmailConnect.start();
    res.cookie(COOKIE, nonce, { ...cookieOptions(), maxAge: 10 * 60_000 });
    res.redirect(StatusCodes.MOVED_TEMPORARILY, url);
  };

// GET /api/gmail/callback. Where Google sends you back. The cookie's used up either way.
export const gmailCallback = async (req, res) =>
  {
    const { code, state, error } = req.query;
    const answer = await gmailConnect.finish({ code, state, error, nonce: cookieOf(req, COOKIE) });
    res.clearCookie(COOKIE, cookieOptions());
    res.redirect(StatusCodes.SEE_OTHER, backToBoard(answer));
  };

// POST /api/gmail/disconnect. Forgets the login and answers with the new status.
export const disconnectGmail = async (req, res) =>
  {
    await gmailConnect.disconnect();
    res.json(await gmailTokens.status());
  };
