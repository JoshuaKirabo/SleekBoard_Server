import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { PasswordHash } from "../../src/services/auth/PasswordHash.js";
import { PasswordReset, Refusal } from "../../src/services/auth/PasswordReset.js";
import { ResetQuestions } from "../../src/scripts/setPassword/ResetQuestions.js";
import { Terminal } from "../../src/scripts/setPassword/Terminal.js";

// set-password without a terminal or a database: PasswordReset with stand-in accounts and sessions, ResetQuestions
// with a scripted terminal, and the real Terminal on in-memory streams. test/auth/reset.pg.test.js runs it against
// Postgres.
const hasher = new PasswordHash();
const ACCOUNT = { id: "u1", email: "owner@example.com", name: "Owner", hasPassword: false, googleIds: ["1234"] };

// Accounts that know one person, and keep every hash they're handed.
class FakeAccounts
  {
    constructor(account = ACCOUNT)
      {
        this.account = account;
        this.kept = [];
      }

    async find(email)
      {
        return email === this.account?.email ? this.account : null;
      }

    async keepHash(userId, hash)
      {
        this.kept.push({ userId, hash });
      }
  }

// Sessions that say they ended three rows, and remember who for.
class FakeSessions
  {
    constructor()
      {
        this.ended = [];
      }

    async endAll(userId)
      {
        this.ended.push(userId);
        return 3;
      }
  }

// Answers from a script, one per question, and keeps everything said and asked.
class ScriptedTerminal
  {
    constructor(answers)
      {
        this.answers = [...answers];
        this.said = [];
        this.asked = [];
      }

    say(text)
      {
        this.said.push(text);
      }

    async ask(question)
      {
        return this.answer(question, false);
      }

    async askHidden(question)
      {
        return this.answer(question, true);
      }

    answer(question, hidden)
      {
        this.asked.push({ question, hidden });
        if(!this.answers.length) throw new Refusal("Stopped before every question was answered.");
        return this.answers.shift();
      }
  }

const resetWith = (accounts, sessions = new FakeSessions()) => ({ reset: new PasswordReset({ accounts, hasher, sessions }), sessions });

// --- PasswordReset ---

test("an unknown email is refused before anything is asked, and nothing is saved", async () =>
  {
    const accounts = new FakeAccounts();
    const { reset, sessions } = resetWith(accounts);
    let asked = false;
    await assert.rejects(reset.run("nobody@example.com", async () => { asked = true; return { password: "pw", signOut: true }; }), (error) => error instanceof Refusal && /no account with the email nobody@example.com/.test(error.message));
    await assert.rejects(reset.run("", async () => ({ password: "pw", signOut: true })), Refusal);
    assert.equal(asked, false);
    assert.deepEqual(accounts.kept, []);
    assert.deepEqual(sessions.ended, []);
  });

test("the typed password is saved as an argon2 hash of it, never as itself, on the account that was shown", async () =>
  {
    const accounts = new FakeAccounts();
    const { reset } = resetWith(accounts);
    let shown;
    const result = await reset.run(ACCOUNT.email, async (account) => { shown = account; return { password: "correct horse", signOut: false }; });
    assert.equal(shown, ACCOUNT);
    assert.equal(accounts.kept.length, 1);
    assert.equal(accounts.kept[0].userId, "u1");
    assert.match(accounts.kept[0].hash, /^\$argon2id\$/);
    assert.equal(await hasher.matches("correct horse", accounts.kept[0].hash), true);
    assert.equal(result.account, ACCOUNT);
  });

test("signing out everywhere ends that user's sessions; saying no leaves them", async () =>
  {
    const yes = resetWith(new FakeAccounts());
    const ended = await yes.reset.run(ACCOUNT.email, async () => ({ password: "pw", signOut: true }));
    assert.deepEqual(yes.sessions.ended, ["u1"]);
    assert.deepEqual({ signedOut: ended.signedOut, ended: ended.ended }, { signedOut: true, ended: 3 });

    const no = resetWith(new FakeAccounts());
    const kept = await no.reset.run(ACCOUNT.email, async () => ({ password: "pw", signOut: false }));
    assert.deepEqual(no.sessions.ended, []);
    assert.deepEqual({ signedOut: kept.signedOut, ended: kept.ended }, { signedOut: false, ended: 0 });
  });

test("an empty password from any asker is refused and nothing is saved", async () =>
  {
    const accounts = new FakeAccounts();
    const { reset, sessions } = resetWith(accounts);
    await assert.rejects(reset.run(ACCOUNT.email, async () => ({ password: "", signOut: true })), Refusal);
    assert.deepEqual(accounts.kept, []);
    assert.deepEqual(sessions.ended, []);
  });

test("giving up halfway through the questions saves nothing", async () =>
  {
    const accounts = new FakeAccounts();
    const { reset, sessions } = resetWith(accounts);
    const questions = new ResetQuestions({ terminal: new ScriptedTerminal(["pw", "pw"]) });
    await assert.rejects(reset.run(ACCOUNT.email, (account) => questions.ask(account)), Refusal);
    assert.deepEqual(accounts.kept, []);
    assert.deepEqual(sessions.ended, []);
  });

// --- ResetQuestions ---

test("the account is shown first, then the password is asked hidden twice, then sign out everywhere", async () =>
  {
    const terminal = new ScriptedTerminal(["pass word ", "pass word ", "n"]);
    const answers = await new ResetQuestions({ terminal }).ask(ACCOUNT);
    assert.deepEqual(answers, { password: "pass word ", signOut: false });
    assert.match(terminal.said[0], /Found account:\n- ID=u1\n- Email=owner@example.com\n- Name=Owner\n- Google ID=1234\n- Password=none yet/);
    assert.deepEqual(terminal.asked.map((question) => question.hidden), [true, true, false]);
    assert.match(terminal.asked[2].question, /Sign out everywhere\? \(Y\/n\)/);
  });

test("an account with a password says it'll be replaced, and one without Google says so", () =>
  {
    const terminal = new ScriptedTerminal([]);
    new ResetQuestions({ terminal }).show({ ...ACCOUNT, name: "", hasPassword: true, googleIds: [] });
    assert.match(terminal.said[0], /- Name=\(none\)\n- Google ID=\(none\)\n- Password=set, will be replaced/);
  });

test("an empty password is refused without asking for it again", async () =>
  {
    const terminal = new ScriptedTerminal(["", "", "y"]);
    await assert.rejects(new ResetQuestions({ terminal }).ask(ACCOUNT), (error) => error instanceof Refusal && /empty/.test(error.message));
    assert.equal(terminal.asked.length, 1);
  });

test("two passwords that don't match are refused", async () =>
  {
    const terminal = new ScriptedTerminal(["correct horse", "correct horsf", "y"]);
    await assert.rejects(new ResetQuestions({ terminal }).ask(ACCOUNT), (error) => error instanceof Refusal && /didn't match/.test(error.message));
  });

test("sign out everywhere: Enter and y mean yes, n means no, anything else asks again", async () =>
  {
    for(const [answers, wanted] of [[[""], true], [["Y"], true], [[" yes "], true], [["No"], false], [["maybe", "n"], false]])
      {
        const terminal = new ScriptedTerminal(answers);
        assert.equal(await new ResetQuestions({ terminal }).signOut(), wanted, JSON.stringify(answers));
      }
    const terminal = new ScriptedTerminal(["maybe", "y"]);
    await new ResetQuestions({ terminal }).signOut();
    assert.deepEqual(terminal.said, ["Answer y or n."]);
  });

// --- Terminal ---

// A terminal on in-memory streams. tty pretends to be a real keyboard, which makes readline echo what's typed.
const fakeTerminal = (tty) =>
  {
    const input = new PassThrough();
    if(tty) input.isTTY = true;
    const output = new PassThrough();
    let shown = "";
    output.on("data", (chunk) => { shown += chunk; });
    return { terminal: new Terminal({ input, output }), input, shown: () => shown };
  };

test("piped answers that arrive before their questions still go to the right question, in order", async () =>
  {
    const { terminal, input, shown } = fakeTerminal(false);
    input.write("hunter2\nhunter2\nn\n");
    assert.equal(await terminal.askHidden("New password: "), "hunter2");
    assert.equal(await terminal.askHidden("Type it again: "), "hunter2");
    assert.equal(await terminal.ask("Sign out everywhere? (Y/n) "), "n");
    terminal.close();
    assert.equal(shown(), "New password: \nType it again: \nSign out everywhere? (Y/n) \n");
  });

test("on a keyboard, a hidden answer isn't echoed but an ordinary one is", async () =>
  {
    const { terminal, input, shown } = fakeTerminal(true);
    const hidden = terminal.askHidden("New password: ");
    input.write("hunter2\r");
    assert.equal(await hidden, "hunter2");
    const open = terminal.ask("Sign out everywhere? (Y/n) ");
    input.write("yes\r");
    assert.equal(await open, "yes");
    terminal.close();
    assert.equal(shown().includes("hunter2"), false, `the password showed: ${JSON.stringify(shown())}`);
    assert.match(shown(), /Sign out everywhere\? \(Y\/n\) yes/);
  });

test("input running out (Ctrl+D, or a pipe ending) is a refusal, not an empty answer", async () =>
  {
    const { terminal, input } = fakeTerminal(false);
    input.end("only one line\n");
    assert.equal(await terminal.askHidden("New password: "), "only one line");
    await assert.rejects(terminal.askHidden("Type it again: "), Refusal);
    terminal.close();
  });
