import { MasterView } from './MasterView';

// "Archived" tab of Corporate Invoicing — the store of issued statements and invoices
// uploaded by the accounts team (e.g. exported from their accounting software), kept
// separate from the system-generated statements on the Generate tab.
export function CustomerPortal() {
  return <MasterView />;
}
