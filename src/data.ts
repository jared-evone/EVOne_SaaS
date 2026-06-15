// ── Shared static data for screens ───────────────────────────────

export const months = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

export const revenueData = [
  82000, 95000, 88000, 110000, 124000, 136000,
  128000, 152000, 165000, 178000, 188000, 204000,
];
export const energyData = [
  12400, 14800, 13200, 16500, 18900, 20300,
  19200, 22800, 24500, 26800, 28900, 31200,
];
export const ordersData: number[][] = [
  [18, 12], [22, 15], [19, 11], [25, 16], [28, 19], [30, 22],
  [27, 18], [35, 24], [38, 26], [42, 29], [46, 31], [52, 35],
];

export type StatusGeneric =
  | 'Completed' | 'Pending' | 'In Progress' | 'Cancelled'
  | 'Active' | 'Inactive' | 'Overdue';

export interface Order {
  id: string;
  customer: string;
  address: string;
  product: string;
  amount: string;
  status: StatusGeneric;
  date: string;
}
export const orders: Order[] = [
  { id: 'ORD-2024-0081', customer: 'Ahmad Razif',         address: 'Bangsar, KL',       product: '7kW Home Charger',  amount: '$3,399', status: 'Completed',   date: '02 May 2026' },
  { id: 'ORD-2024-0080', customer: 'Nurul Ain Bt Hassan', address: 'Petaling Jaya, SL', product: '22kW Commercial',   amount: '$8,800', status: 'In Progress', date: '01 May 2026' },
  { id: 'ORD-2024-0079', customer: 'Lee Cheng Wei',       address: 'Mont Kiara, KL',    product: '7kW Home Charger',  amount: '$3,399', status: 'Pending',     date: '30 Apr 2026' },
  { id: 'ORD-2024-0078', customer: 'Priya Rajendran',     address: 'Cyberjaya, SL',     product: '22kW Commercial',   amount: '$8,800', status: 'Completed',   date: '29 Apr 2026' },
  { id: 'ORD-2024-0077', customer: 'Hafiz Mohd Noor',     address: 'Shah Alam, SL',     product: '7kW Home Charger',  amount: '$3,399', status: 'Cancelled',   date: '28 Apr 2026' },
  { id: 'ORD-2024-0076', customer: 'Tan Siew Ling',       address: 'Cheras, KL',        product: '7kW Home Charger',  amount: '$3,399', status: 'Completed',   date: '27 Apr 2026' },
  { id: 'ORD-2024-0075', customer: 'Mohd Farid Roslan',   address: 'Subang, SL',        product: '22kW Commercial',   amount: '$8,800', status: 'In Progress', date: '26 Apr 2026' },
];

export interface Installation {
  id: string;
  customer: string;
  address: string;
  tech: string;
  scheduled: string;
  product: string;
  status: StatusGeneric;
}
export const installations: Installation[] = [
  { id: 'INS-0124', customer: 'Ahmad Razif',     address: 'Jln Riong, Bangsar, 59100 KL',          tech: 'Zulkifli A.', scheduled: '05 May 2026', product: '7kW',  status: 'Pending'     },
  { id: 'INS-0123', customer: 'Nurul Ain',       address: 'Jln SS2, PJ, 47300 SL',                 tech: 'Ramesh K.',   scheduled: '04 May 2026', product: '22kW', status: 'In Progress' },
  { id: 'INS-0122', customer: 'Lee Cheng Wei',   address: 'Jln Kiara, Mont Kiara, 50480 KL',       tech: 'David T.',    scheduled: '03 May 2026', product: '7kW',  status: 'Completed'   },
  { id: 'INS-0121', customer: 'Priya Rajendran', address: 'Persiaran APEC, Cyberjaya, 63000 SL',   tech: 'Zulkifli A.', scheduled: '02 May 2026', product: '22kW', status: 'Completed'   },
  { id: 'INS-0120', customer: 'Hafiz Mohd Noor', address: 'Jln SAS 3, Shah Alam, 40150 SL',        tech: 'Ramesh K.',   scheduled: '01 May 2026', product: '7kW',  status: 'Overdue'     },
  { id: 'INS-0119', customer: 'Tan Siew Ling',   address: 'Jln Cheras, 56100 KL',                  tech: 'David T.',    scheduled: '30 Apr 2026', product: '7kW',  status: 'Completed'   },
];

export interface Customer {
  name: string;
  email: string;
  type: 'Residential' | 'Commercial' | 'Enterprise';
  installs: number;
  spend: string;
  status: 'Active' | 'Inactive';
  joined: string;
}
export const customers: Customer[] = [
  { name: 'Ahmad Razif Bin Hamid', email: 'ahmad.razif@email.com',     type: 'Residential', installs: 1,  spend: '$3,399',    status: 'Active',   joined: 'Mar 2026' },
  { name: 'Nurul Ain Bt Hassan',   email: 'nurul.ain@company.com',     type: 'Commercial',  installs: 3,  spend: '$26,400',   status: 'Active',   joined: 'Jan 2026' },
  { name: 'Lee Cheng Wei',         email: 'lee.cw@email.com',          type: 'Residential', installs: 1,  spend: '$3,399',    status: 'Active',   joined: 'Apr 2026' },
  { name: 'Priya Rajendran',       email: 'priya.r@techco.com',        type: 'Commercial',  installs: 5,  spend: '$44,000',   status: 'Active',   joined: 'Nov 2025' },
  { name: 'Hafiz Mohd Noor',       email: 'hafiz.mn@email.com',        type: 'Residential', installs: 1,  spend: '$3,399',    status: 'Inactive', joined: 'Apr 2026' },
  { name: 'Tan Siew Ling',         email: 'siewling@email.com',        type: 'Residential', installs: 2,  spend: '$6,798',    status: 'Active',   joined: 'Feb 2026' },
  { name: 'YTL PowerSeraya',       email: 'procurement@ytl.com.my',    type: 'Enterprise',  installs: 18, spend: '$158,400',  status: 'Active',   joined: 'Jun 2025' },
];
