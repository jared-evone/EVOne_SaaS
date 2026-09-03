-- Default CC for PO approval emails (Raise PO -> Email Template tab).
--
-- CC recipients receive a SEPARATE "FYI:" copy of the approval email with the
-- Approve/Reject buttons replaced by a note naming the approver — the action
-- links only ever go to the approver's own inbox, so a CC cannot approve.
--
-- APPLIED as migration `po_settings_cc_email`.

alter table public.po_settings
  add column if not exists cc_email text;
