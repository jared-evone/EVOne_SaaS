-- Installation (Form 1) invoice on a charger — mirrors the invoice columns the
-- LTA Form A/D records carry. PDFs live in the charger-forms bucket under
-- form-1-invoice/…; both delete sweeps (registry/site/charger) remove them.
--
-- APPLIED as migration `site_chargers_form1_invoice`.

alter table public.site_chargers
  add column if not exists form_1_invoice_path text,
  add column if not exists form_1_invoice_filename text;
