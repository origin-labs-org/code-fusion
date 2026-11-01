import { create } from "zustand";
import type {
  FeedbackTicketModule,
  FeedbackTicketSeverity,
  FeedbackTicketType,
} from "@origin-ai/cf-shared";

type FeedbackTab = "submit" | "tickets";

export interface FeedbackAttachmentDraft {
  readonly filename: string;
  readonly contentType: string;
  readonly dataBase64: string;
  readonly size: number;
}

export interface FeedbackSubmitDraft {
  readonly title?: string;
  readonly description?: string;
  readonly contact?: string;
  readonly type?: FeedbackTicketType;
  readonly module?: FeedbackTicketModule;
  readonly severity?: FeedbackTicketSeverity;
  readonly screenshots?: readonly FeedbackAttachmentDraft[];
  readonly includeLogs?: boolean;
}

interface FeedbackUiState {
  open: boolean;
  featureRequestOpen: boolean;
  tab: FeedbackTab;
  submitDraft: FeedbackSubmitDraft | null;
  
  submissionJobId: string | null;
  
  selectedTicketId: string | null;
  
  openSubmit: (draft?: FeedbackSubmitDraft) => void;
  
  openSubmissionJob: (jobId: string) => void;
  
  openFeatureRequest: () => void;
  
  openTickets: (ticketId?: string) => void;
  
  setTab: (tab: FeedbackTab) => void;
  setSelectedTicketId: (ticketId: string | null) => void;
  close: () => void;
}

export const useFeedbackStore = create<FeedbackUiState>((set) => ({
  open: false,
  featureRequestOpen: false,
  tab: "submit",
  submitDraft: null,
  submissionJobId: null,
  selectedTicketId: null,
  openSubmit: (draft) =>
    set({
      open: true,
      featureRequestOpen: false,
      tab: "submit",
      submitDraft: draft ?? null,
      submissionJobId: null,
      selectedTicketId: null,
    }),
  openSubmissionJob: (jobId) =>
    set({
      open: true,
      featureRequestOpen: false,
      tab: "submit",
      submitDraft: null,
      submissionJobId: jobId,
      selectedTicketId: null,
    }),
  openFeatureRequest: () =>
    set({
      open: false,
      featureRequestOpen: true,
      submitDraft: null,
      submissionJobId: null,
      selectedTicketId: null,
    }),
  openTickets: (ticketId) =>
    set({
      open: true,
      featureRequestOpen: false,
      tab: "tickets",
      submitDraft: null,
      submissionJobId: null,
      selectedTicketId: ticketId ?? null,
    }),
  setTab: (tab) =>
    set({
      tab,
      ...(tab === "submit" ? { submissionJobId: null } : {}),
    }),
  setSelectedTicketId: (ticketId) => set({ selectedTicketId: ticketId }),
  close: () =>
    set({
      open: false,
      featureRequestOpen: false,
      submitDraft: null,
      submissionJobId: null,
      selectedTicketId: null,
    }),
}));
