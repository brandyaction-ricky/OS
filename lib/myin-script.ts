// 마이인 v13 (Logan's concept 3, owner decision 2026-10-19): the render PC runs Logan's stage_voice.py unchanged, so the OS
// must hand Fish exactly the paragraphs his clean_script() speaks. This is that function, line for line, plus the step
// that turns an OS manuscript (원고 공정 정본 §8) into the script file his pipeline reads.

// Logan's SKIP_PREFIX in stage_voice.py.
const SKIP_PREFIX = ["[확인]", "[추론]", "[추측]", "구조 구분", "제목:", "썸네일", "# ", "https://", "["];

/** clean_script(): every non-empty line is a paragraph; "## " titles are sections (not spoken); a 출처 section ends the script. */
export function myinCleanScript(md: string) {
  const paras: string[] = []; const sections: string[] = []; let inSource = false;
  for (const raw of md.replace(/\r/g, "").split("\n")) {
    const s = raw.trim();
    if (!s) continue;
    if (s.startsWith("## ")) {
      const title = s.slice(3).trim();
      if (title.includes("출처")) { inSource = true; continue; }
      inSource = false;
      sections.push(title); paras.push(`#SECTION ${title}`); continue;
    }
    if (inSource || SKIP_PREFIX.some((prefix) => s.startsWith(prefix))) continue;
    if (s.startsWith("#")) continue;
    paras.push(s);
  }
  return { paras, sections, spoken: paras.filter((p) => !p.startsWith("#SECTION")) };
}

/**
 * The script file for Logan's pipeline: the §8 manuscript without its HTML comment head lines (his clean_script would speak
 * them). A script with no manuscript (hand-pasted narration) is its paragraphs, one per line.
 */
export function myinScriptMarkdown(manuscript: string | null, narration: string) {
  const source = manuscript?.trim() ? manuscript : narration.split(/\n\s*\n/).map((p) => p.replace(/\s*\n\s*/g, " ").trim()).filter(Boolean).join("\n\n");
  return source.replace(/\r/g, "").split("\n").filter((line) => !line.trim().startsWith("<!--")).join("\n").trim() + "\n";
}
