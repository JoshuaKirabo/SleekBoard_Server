import { createHash } from "node:crypto";
import { RateLimiterMemory, RateLimiterPostgres, RateLimiterRes } from "rate-limiter-flexible";

// How many wrong email + password sign-ins are let through, after node-rate-limiter-flexible's wiki ("Login endpoint
// protection", Overall-example.md). Two counts, of failures only: every try is counted before its password is
// checked, and a right password takes its count back.
//
//   per IP         100 failed tries a day, any email, then that IP is turned away for a day. Stops slow guessing
//                  across many emails.
//   per email + IP 10 failed tries in a row, then that email from that IP is turned away for an hour. A right
//                  password wipes it. Someone guessing the owner's password from one place stops there, but the owner,
//                  from their own network, isn't locked out by them.
//
// The counts live in Postgres (login_limits), so a restart or a second server doesn't reset them.
export const MAX_FAILS_PER_IP_PER_DAY = 100;
export const MAX_FAILS_IN_A_ROW = 10;

const DAY_SECONDS = 24 * 60 * 60;
// The wiki keeps a run of fails 90 days from the first one, so only a right password resets it.
const RUN_SECONDS = 90 * DAY_SECONDS;
// The library's memory store ends each count with a setTimeout, and Node can't time past about 24.8 days: anything
// longer fires at once and the count vanishes. So in memory a run lasts 24 days. Postgres keeps an expiry date instead.
const MEMORY_RUN_SECONDS = 24 * DAY_SECONDS;

export class LoginLimits
  {
    constructor({ byIp, byEmailAndIp })
      {
        this.byIp = byIp;
        this.byEmailAndIp = byEmailAndIp;
      }

    // The server's own: both counts in the login_limits table, on the pool the sessions use. The table comes from a
    // Prisma migration, since the server's database user can't create one, so the library is told it's there.
    static inPostgres({ pool, prefix = "login" })
      {
        return LoginLimits.over(RateLimiterPostgres, { prefix, runSeconds: RUN_SECONDS, storeClient: pool, tableName: "login_limits", tableCreated: true });
      }

    // Counts kept in this process only. For tests.
    static inMemory({ prefix = "login" } = {})
      {
        return LoginLimits.over(RateLimiterMemory, { prefix, runSeconds: MEMORY_RUN_SECONDS });
      }

    // The wiki's two limiters, on any of the library's stores. `prefix` keeps one set of counts apart from another
    // in the same table (the tests use their own).
    static over(Limiter, { prefix, runSeconds, ...store })
      {
        const byIp = new Limiter(
          {
            ...store,
            keyPrefix: `${prefix}_fail_ip_per_day`,
            points: MAX_FAILS_PER_IP_PER_DAY,
            duration: DAY_SECONDS,
            blockDuration: DAY_SECONDS,
          });
        const byEmailAndIp = new Limiter(
          {
            ...store,
            keyPrefix: `${prefix}_fail_in_a_row_email_ip`,
            points: MAX_FAILS_IN_A_ROW,
            duration: runSeconds,
            blockDuration: 60 * 60,
          });
        return new LoginLimits({ byIp, byEmailAndIp });
      }

    // The email + IP key. The email is PasswordLogin's (trimmed, lowercase), hashed so it always fits the library's
    // 255-character key column (an email can be 320) and the table doesn't collect what strangers typed.
    keyOf(login, ip)
      {
        const email = createHash("sha256").update(login.email()).digest("hex");
        return `${email}_${ip}`;
      }

    // Every try counts before its password is checked, with the library's consume (one atomic upsert in Postgres), so
    // tries sent all at once can't all read "under the limit" before any is written. 0 if this try may go ahead, else
    // the seconds left on the block. The IP goes first: a blocked IP doesn't get to add email + IP rows. A store error
    // is thrown, never read as "under the limit".
    async countTry(login, ip)
      {
        const perIp = await this.take(this.byIp, ip);
        if(perIp > 0) return perIp;
        return this.take(this.byEmailAndIp, this.keyOf(login, ip));
      }

    // One point from one limiter: 0 while it's within its limit, else the seconds until it lets this key in again.
    // Never more than the limiter's block: in a burst, a try can go over before the try that crossed the limit has
    // written the block, and would otherwise read the run's 90 days as its wait.
    async take(limiter, key)
      {
        try
          {
            await limiter.consume(key);
            return 0;
          }
        catch(rejected)
          {
            if(!(rejected instanceof RateLimiterRes)) throw rejected;
            return Math.min(this.secondsOf(rejected), limiter.blockDuration);
          }
      }

    // A right password: that email's run of fails from this IP ends, and the IP gets its point back, so only failures
    // count against its day.
    async succeeded(login, ip)
      {
        await Promise.all([this.clearRun(login, ip), this.giveBack(ip)]);
      }

    async clearRun(login, ip)
      {
        await this.byEmailAndIp.delete(this.keyOf(login, ip));
      }

    async giveBack(ip)
      {
        await this.byIp.reward(ip, 1);
      }

    // Whole seconds, rounded up so a client that waits exactly this long isn't turned away again. Never 0.
    secondsOf(count)
      {
        return Math.max(1, Math.ceil(count.msBeforeNext / 1000));
      }
  }
