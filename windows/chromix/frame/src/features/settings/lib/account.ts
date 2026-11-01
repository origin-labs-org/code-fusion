import type { AccountFaultV1, AccountSignupModeV1 } from "$shared/ipc/bindings";
import * as m from "$shared/i18n/messages";

export const TERMS_URL = "https://zephium.app/terms";
export const PRIVACY_URL = "https://zephium.app/privacy";
export const SUPPORT_MAIL = "mailto:support@zephium.app";

/** What a fault means to the person, in one sentence. */
export function explainAccountFault(
  fault: AccountFaultV1,
  retryAfter: number | null,
  signupMode?: AccountSignupModeV1 | null,
): string {
  switch (fault) {
    case "offline":
      return m.account_fault_offline();
    case "signed_out":
      return m.account_fault_signed_out();
    case "rate_limited":
      return m.account_fault_rate_limited({ seconds: Math.max(1, retryAfter ?? 60) });
    case "invalid_code":
      return m.account_fault_invalid_code();
    case "signup_closed":
      return signupMode === "allowlist"
        ? m.account_fault_signup_invite_only()
        : m.account_fault_signup_closed();
    case "unavailable":
      return m.account_fault_unavailable();
    case "no_billing_account":
      return m.account_fault_no_billing();
    case "server":
      return m.account_fault_server();
    case "vault":
      return m.account_fault_vault();
    case "invalid":
      return m.account_fault_invalid();
    case "reauth_required":
      return m.account_fault_reauth();
    case "email_taken":
      return m.account_fault_email_taken();
    case "not_found":
      return m.account_fault_not_found();
    case "billing_review":
      return m.account_fault_billing_review();
    case "checkout_in_progress":
      return m.account_fault_checkout_in_progress();
    case "subscription_change_required":
      return m.account_fault_subscription_change_required();
    case "billing_refresh_required":
      return m.account_fault_billing_refresh_required();
    case "plan_change_in_progress":
      return m.account_fault_plan_change_in_progress();
    case "plan_change_expired":
      return m.account_fault_plan_change_expired();
    case "plan_change_unavailable":
      return m.account_fault_plan_change_unavailable();
    case "avatar_invalid":
      return m.account_fault_avatar_invalid();
    case "avatar_timeout":
      return m.account_fault_avatar_timeout();
    case "avatar_too_large":
      return m.account_fault_avatar_too_large();
    case "avatar_unsupported":
      return m.account_fault_avatar_unsupported();
    case "avatar_dimensions":
      return m.account_fault_avatar_dimensions();
    case "avatar_processing":
      return m.account_fault_avatar_processing();
    case "avatar_busy":
      return m.account_fault_avatar_busy({ seconds: Math.max(1, retryAfter ?? 30) });
    case "avatar_cancelled":
      return m.account_fault_avatar_cancelled();
  }
}

/** Why a plan change ended as `failed`, from its stable code. */
export function explainChangeError(code: string | null): string {
  switch (code) {
    case "payment_failed":
      return m.account_change_failed_payment();
    case "billing_review_required":
      return m.account_fault_billing_review();
    default:
      return m.account_change_failed_other();
  }
}

export function plausibleEmail(text: string): boolean {
  const email = text.trim();
  const at = email.lastIndexOf("@");
  if (at < 1 || email.length > 254 || /\s/u.test(email)) return false;
  const domain = email.slice(at + 1);
  return domain.includes(".") && !domain.startsWith(".") && !domain.endsWith(".");
}

/** The six digits a person typed or pasted, ignoring spaces and dashes. */
export function codeDigits(text: string): string {
  return text.replace(/[\s-]/gu, "").replace(/\D/gu, "").slice(0, 6);
}
