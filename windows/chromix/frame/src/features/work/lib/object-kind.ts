import type { IconSvgElement } from "@hugeicons/svelte";
import type { ObjectKind } from "./board/types";
import {
  BrowserIcon,
  ChartColumnIcon,
  CheckListIcon,
  CubeIcon,
  Doc01Icon,
  File01Icon,
  Folder01Icon,
  GitCompareIcon,
  Image01Icon,
  LayoutGridIcon,
  Message01Icon,
  PencilEdit02Icon,
  SourceCodeIcon,
  StickyNote03Icon,
  Table01Icon,
} from "./icons";
import * as m from "$shared/i18n/messages";

const ICONS: Record<ObjectKind, IconSvgElement> = {
  reply: Message01Icon,
  plot: ChartColumnIcon,
  sheet: Table01Icon,
  picks: LayoutGridIcon,
  plan: CheckListIcon,
  list: CheckListIcon,
  diagram: CubeIcon,
  code: SourceCodeIcon,
  diff: GitCompareIcon,
  document: Doc01Icon,
  draft: PencilEdit02Icon,
  media: Image01Icon,
  page: BrowserIcon,
  note: StickyNote03Icon,
  file: File01Icon,
  folder: Folder01Icon,
  project: CubeIcon,
  subject: Doc01Icon,
};

const LABELS: Record<ObjectKind, () => string> = {
  reply: m.work_object_kind_reply,
  plot: m.work_object_kind_plot,
  sheet: m.work_object_kind_sheet,
  picks: m.work_object_kind_picks,
  plan: m.work_object_kind_plan,
  list: m.work_object_kind_list,
  diagram: m.work_object_kind_diagram,
  code: m.work_object_kind_code,
  diff: m.work_object_kind_diff,
  document: m.work_object_kind_document,
  draft: m.work_object_kind_draft,
  media: m.work_object_kind_media,
  page: m.work_object_kind_page,
  note: m.work_object_kind_note,
  file: m.work_object_kind_file,
  folder: m.work_object_kind_folder,
  project: m.work_object_kind_project,
  subject: m.work_object_kind_subject,
};

/** The mark an object is known by in a list or an opened view's header. */
export const objectIcon = (kind: ObjectKind): IconSvgElement => ICONS[kind];

/** What an object is, in a word: Chart, Table, Plan. */
export const objectLabel = (kind: ObjectKind): string => LABELS[kind]();
