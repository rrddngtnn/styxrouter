# Retained upstream notices and unresolved provenance

This directory preserves inspected upstream licence texts. It is not a grant of
rights in the combined package, a project relicense, or a compliance certificate.
The root and server `LICENSE` files record MIT grants; neither replaces the
licences of separately sourced code. Do not describe this package as MIT-only.

| Retained source / reference | Inspected licence text | Scope and limitation |
| --- | --- | --- |
| 9Router source ports | `9router-MIT.txt` | MIT at `3a978a631ad65529c06e48ce495092d5bba29f46`; exact historical imports not fully audited. |
| Hailuo/gpt4free port | `gpt4free-GPL-3.0.txt` | GNU GPL version 3 at `e3127d4a261a85abb9cdcf8d7821e7bf0097ae44`; `open-sse/executors/hailuo-web.ts` explicitly identifies the 1:1 signing/SSE port from `HailuoAI.py` and `crypt.py`. Exact import, GPL only/or-later choice, and combined-work obligations remain unresolved. |
| gcf-typescript vendored generic codec | `gcf-typescript-historical-MIT.txt` | MIT at `a5ee0d400de441e8098eea083168fd25100a41b4`; local source differs. Upstream changed to Apache-2.0 later. No exact import revision or provenance of every local change has been established. |
| Free Claude Code stream-recovery reference | `free-claude-code-historical-MIT.txt` | MIT at `e79b430cc27b63c690b5d782b045c213b9a873c5`; later upstream is AGPL-3.0-only. The historical reference does not establish the revision of every local port. |

`upstream-sources.json` records pinned URLs, byte lengths, and SHA-256 digests of
inspected upstream files. Entries for source files and the later Free Claude Code
licence are evidence references, not a statement that those files are included
here or that their licences apply to the entire package.

For full evidence and additional unresolved sources, see the root repository
`CREDITS.md`; it is not included in this package. Other references include
gpt4free comments in `qwen-web.ts` and `gemini-web.ts`, ZCode client identity,
named ports from other projects, and
`open-sse/vendor/codex-chatgpt-web/`, whose directory name alone does not establish
its source or licence. Brand assets have a separate
`panel/brand/LICENSE-NOTICE.txt` when included in the built panel.

Resolve the applicable source licences and distribution requirements before
publishing. Retaining these texts alone does not resolve the GPL-source issue.
