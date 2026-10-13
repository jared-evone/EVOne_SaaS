-- 2026-10-13 · migration cpo_sales_pipeline — CPO Sales Pipeline (CPO
-- department): the Sales Pipeline, for selling CPO locations to other CPOs.
-- Same columns / statuses / won stages as sales_quotations, in its own table so
-- CPO deals never show in the sales pipeline or Sales Dashboard. Refs CQ-YYYY-NNNN.
-- Quote PDFs share the private sales-quotations bucket under a cpo/ prefix.
create sequence cpo_sales_quotation_ref;
create table cpo_sales_quotations (like sales_quotations including defaults including constraints including indexes);
alter table cpo_sales_quotations
  alter column ref set default ('CQ-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('cpo_sales_quotation_ref')::text, 4, '0'));
alter sequence cpo_sales_quotation_ref owned by cpo_sales_quotations.ref;
alter table cpo_sales_quotations
  add constraint cpo_sales_quotations_customer_id_fkey foreign key (customer_id) references customers(id) on delete set null;
alter table cpo_sales_quotations enable row level security;
create policy "authenticated full access" on cpo_sales_quotations for all to authenticated using (true) with check (true);

-- Data (execute_sql): screen key cpo_sales granted view/edit/delete to the two
-- CPO department admins (admin@evone.com.sg, kyleson@evone.com.sg) so they keep
-- department-admin status now that CPO has one more screen.
