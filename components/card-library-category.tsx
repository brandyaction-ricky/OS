import { BookOpen, ChevronDown, Files, FolderOpen, Info, ListChecks, PanelsTopLeft } from "lucide-react";
import { CATEGORY_IDS, LIBRARY_LABELS, libraryCategory, type CardCategory, type LibraryCategory } from "@/lib/cardnews/categories";
import { CARD_FORMATS } from "@/lib/cardnews/formats";
import { projectName, type YpProject } from "@/lib/youtube-process/project";

const icons = { all: Files, guide: ListChecks, webtoon: PanelsTopLeft, story: BookOpen, information: Info, unassigned: FolderOpen };
export type CategoryFilter = LibraryCategory | "all";

export function CategoryFilters({ projects, value, onChange }: {
  projects: YpProject[]; value: CategoryFilter; onChange: (value: CategoryFilter) => void;
}) {
  const counts = { all: projects.length, guide: 0, webtoon: 0, story: 0, information: 0, unassigned: 0 };
  for (const project of projects) counts[libraryCategory(project.yp.cardCategory, project.cardSummary)]++;
  return <fieldset className="yp-library-filters">
    <legend>카테고리</legend>
    <div>{(["all", ...CATEGORY_IDS, "unassigned"] as const).map(id => {
      const Icon = icons[id];
      return <button key={id} type="button" data-category={id} aria-pressed={value === id} onClick={() => onChange(id)}>
        <Icon size={16} aria-hidden="true" />{LIBRARY_LABELS[id]}<span>{counts[id]}</span>
      </button>;
    })}</div>
  </fieldset>;
}

export function CardIdentity({ project, disabled, onChange }: {
  project: YpProject; disabled?: boolean; onChange?: (value: CardCategory | null) => void;
}) {
  const summary = project.cardSummary;
  const category = libraryCategory(project.yp.cardCategory, summary);
  const Icon = icons[category];
  const name = LIBRARY_LABELS[category];
  const format = summary?.format ? CARD_FORMATS[summary.format].name : "";
  const details = format && summary ? [format !== name && format, `${summary.slides}장`]
    : [summary?.candidates ? `초안 ${summary.candidates}개 · 선택 전` : "포맷 선택 전"];
  return <div className="yp-library-identity">
    <span className="yp-library-badge" data-category={category}>
      <Icon size={15} aria-hidden="true" />{name}
      {onChange && <><ChevronDown size={12} aria-hidden="true" />
        <select aria-label={`${projectName(project)} 카테고리 변경`} disabled={disabled} value={project.yp.cardCategory ?? ""}
          onChange={event => onChange(CATEGORY_IDS.find(id => id === event.target.value) ?? null)}>
          <option value="">포맷에 따라 자동 분류 · {LIBRARY_LABELS[libraryCategory(null, summary)]}</option>
          {CATEGORY_IDS.map(id => <option key={id} value={id}>{LIBRARY_LABELS[id]}</option>)}
        </select></>}
    </span>
    <span className="yp-library-format">{details.filter(Boolean).join(" · ")}</span>
  </div>;
}
