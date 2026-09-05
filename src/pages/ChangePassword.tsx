import { useState } from "react";
import { KeyRound, ShieldCheck } from "lucide-react";
import { authApi } from "../lib/api";
import { useStore } from "../store";
import { Btn, Field, Input } from "../components/ui";

export default function ChangePassword() {
  const { user, logout, toast } = useStore();
  const required = !!(user as (typeof user & { mustChangePassword?: boolean }))?.mustChangePassword;
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!current) { toast("Enter your current password", "err"); return; }
    if (next.length < 8) { toast("New password must be at least 8 characters", "err"); return; }
    if (next !== confirm) { toast("New passwords do not match", "err"); return; }
    if (current === next) { toast("Choose a different new password", "err"); return; }
    setBusy(true);
    try {
      await authApi.changePassword(current, next);
      toast("Password changed successfully", "ok", "Please sign in again with your new password.");
      logout();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not change password", "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dot-grid flex min-h-screen items-center justify-center bg-paper p-4 dark:bg-[#0b1013] sm:p-6">
      <div className="card a-scale-in w-full max-w-md p-5 sm:p-8">
        <div className="text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300">
            <KeyRound size={26} />
          </span>
          <h1 className="hd mt-4 text-[20px]">{required ? "Create your new password" : "Change your password"}</h1>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-500">
            {required
              ? `${user?.name ? `${user.name}, ` : ""}your temporary/reset password must be changed before CRM access is enabled.`
              : "Enter your current password and choose a new secure password."}
          </p>
        </div>

        <div className="mt-6 space-y-4">
          <Field label={required ? "Temporary / current password" : "Current password"} req>
            <Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          </Field>
          <Field label="New password" req>
            <Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
          </Field>
          <Field label="Confirm new password" req>
            <Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void save(); }} />
          </Field>
          <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-[12px] leading-relaxed text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">
            <span className="flex items-start gap-2"><ShieldCheck size={15} className="mt-0.5 shrink-0" /> Use at least 8 characters and do not reuse the current/temporary password.</span>
          </div>
          <Btn className="w-full justify-center" loading={busy} onClick={() => void save()}><KeyRound size={15} /> Change password</Btn>
        </div>
      </div>
    </div>
  );
}
