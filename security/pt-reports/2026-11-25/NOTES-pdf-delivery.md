# PDF delivery — 2026-11-25

The weekly PT PDF for 2026-11-25 was built successfully but is not
checked in to this folder. Reason: the GitHub MCP tool used by the
scheduled audit (`create_or_update_file` / `push_files`) accepts
`content` as a UTF-8 string that the server base64-encodes before
calling the GitHub Contents API. Non-UTF-8 bytes (common in PDFs)
therefore corrupt in transit. Pushing a corrupt PDF would be worse
than not pushing it at all, so this cycle the PDF is delivered via
the chat only.

## What exists for this cycle

- `findings.json` — in this folder. Machine-readable; next week's
  audit diffs against it.
- `README.md` — in this folder. Human summary.
- The PDF itself — delivered through the chat run this task fired
  from (SendUserFile). Also kept in the audit history at
  `/home/claude/audit-history/2026-11-25/` in that session's
  sandbox.

## PDF integrity

- Filename: `mishmert-pt-report-2026-11-25.pdf`
- Pages: 41
- Size: 364 557 bytes
- SHA-256: `60487cc5a29782de4def0b106e8e0fc5d326023e4b984379fc04e858fd590d11`
- Generated: 2026-11-25 ≈ 13:54 UTC by weasyprint 70.0

If you have the chat-delivered copy on your computer, you can verify
with `shasum -a 256 mishmert-pt-report-2026-11-25.pdf` against the hash
above.

## Fix for next week

Either (a) give the scheduled task's environment a GitHub binary-
upload path (e.g. a pre-authenticated `gh release upload` or a
`git push` with a short-lived token), or (b) switch the scheduled
task to use a non-MCP push tool for binaries while keeping MCP for
text. Tracked as a follow-up item for the next scheduled run.
