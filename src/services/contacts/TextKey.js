// How career-ops folds names before comparing them, ported from its tracker-parse.mjs (normalizeTextKey) and
// lib/ascii-fold.mjs (asciiFold). Same steps, same edge cases, in a class.
//
// career-ops is MIT licensed: Copyright (c) 2026 Santiago Fernández de Valderrama.
// https://github.com/career-ops-hq/career-ops

// Latin letters that don't break apart under NFD, so stripping accent marks alone would delete them. Lowercase only,
// since ascii() lowercases first.
const NON_DECOMPOSING_LATIN =
  [
    [/ø/g, "o"], [/æ/g, "ae"], [/œ/g, "oe"], [/ß/g, "ss"],
    [/đ/g, "d"], [/ł/g, "l"], [/þ/g, "th"], [/ð/g, "d"],
    [/ħ/g, "h"], [/ı/g, "i"], [/ŋ/g, "ng"], [/ŧ/g, "t"],
    [/ĸ/g, "k"], [/ſ/g, "s"],
  ];

export class TextKey
  {
    // One key per name, give or take case and punctuation: "ACME, Inc" and "Acme Inc." are both "acmeinc". NFKC
    // without NFD on purpose, so Żubr and Zubr stay two companies. The dot a lowercased Turkish İ leaves behind goes,
    // so İstanbul and Istanbul are one.
    key(value, separator = "")
      {
        return String(value ?? "")
          .normalize("NFKC")
          .toLowerCase()
          .replace(/̇/gu, "")
          .replace(/[^\p{L}\p{M}\p{N}]+/gu, separator)
          .trim();
      }

    // A name folded to plain a-z and 0-9. "space" turns leftover punctuation into a gap, "delete" drops it. Text with
    // no Latin letters at all (Chinese, Cyrillic) comes back empty, and the caller decides what that means.
    ascii(value, { punctuation = "space" } = {})
      {
        let out = String(value ?? "").toLowerCase().normalize("NFD").replace(/\p{M}+/gu, "");
        for(const [pattern, to] of NON_DECOMPOSING_LATIN) out = out.replace(pattern, to);
        out = punctuation === "delete" ? out.replace(/[^a-z0-9 ]/g, "") : out.replace(/[^a-z0-9\s]/g, " ");
        return out.replace(/\s+/g, " ").trim();
      }
  }
