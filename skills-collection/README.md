# Skills collection

Collect every Claude skill available in a Claude Code environment (built-in Anthropic skills,
personal skills, and all installed plugin skills/commands) into one folder and one zip.

```bash
./skills-collection/collect-skills.sh
```

Output: `skills-collection/all-skills/` (one folder per group) and `skills-collection/all-skills.zip`.
`INDEX.md` lists every collected skill with its description.

The collected files themselves are not committed: some Anthropic skills carry a proprietary
license and this repository is public.
