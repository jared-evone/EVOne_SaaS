-- Inventory department — data migrated from the Excel workbook, 2026-10-01.
-- Transcribed from screenshots of: INVENTORY — STOCK LEVELS, PURCHASE REQUESTS,
-- INCOMING SHIPMENT TRACKER, GOODS RECEIVED LOG. Every visible row is here,
-- verbatim. Rows 7 and 10 of the stock sheet were hidden in the screenshot and
-- are NOT included.
--
-- How history is kept without double-counting stock:
--  • Stock levels become OPENING movements (Toh Guan / Paya Ubi "Now" values,
--    Spoilt into the quarantine location). Negative balances are kept as-is.
--  • Shipments marked Received and GRN lines already received are stored as
--    history only (legacy, posted = false) — their quantities are already in
--    the opening balances. Open shipments and the 3 pending GRN lines post to
--    stock when they are received in the app.
--  • Purchase requests had no status in Excel — they import as 'legacy'
--    ("status not tracked") and never touch stock unless re-processed.

-- Locations
insert into inv_locations (name, code, usable, sort_order) values
  ('Toh Guan', 'TG', true, 1),
  ('Paya Ubi', 'PU', true, 2),
  ('Spoilt', 'SP', false, 3);

-- Items + opening balances (sort_order = Excel row number)
with src (row_no, name, brand, category, tg, pu, spoilt, reorder_point, reorder_qty) as (values
  (3,  'Hici AC - 7kW - Standard (5m)',              'Hici',      'Charger',      24, 44, 1, 98,   120),
  (4,  'Hici AC - 7kW - Standard (7m)',              'Hici',      'Charger',       1,  0, 0, null, null),
  (5,  'Hici AC - 7kW - Premium (7m)',               'Hici',      'Charger',       4, 26, 2, 6,    10),
  (6,  'Hici AC - 7kW - Premium (7m) - Wooden',      'Hici',      'Charger',      27,  0, 0, null, null),
  (8,  'Hici AC - 22kW - Standard (5m)',             'Hici',      'Charger',      -9, 11, 3, 31,   40),
  (9,  'Hici AC - 22kW - Premium (7m)',              'Hici',      'Charger',      28,  5, 1, 19,   25),
  (11, 'Hici DC - 30kW - no gun',                    'Hici',      'Charger',       1,  0, 0, null, null),
  (12, 'Hici DC - 30kW - 7m gun',                    'Hici',      'Charger',       3,  0, 0, null, null),
  (13, 'Hici DC - 30kW Standing Pole',               'Hici',      'Accessories',   2,  0, 0, null, null),
  (14, 'Hici DC - 60kW - 7m gun',                    'Hici',      'Charger',       1,  0, 0, null, null),
  (15, 'Hici DC - 120kW - 7m gun',                   'Hici',      'Charger',       1, -1, 0, null, null),
  (16, 'Hici DC - 180kW - 7m gun',                   'Hici',      'Charger',       0,  0, 0, null, null),
  (17, 'Hici DC - 240kW - 7m gun',                   'Hici',      'Charger',       0,  0, 0, null, null),
  (18, 'Hici DC - 360kW - 7m gun',                   'Hici',      'Charger',       2,  0, 0, null, null),
  (19, 'Hiconics - 120kW',                           'Hiconics',  'Charger',       0,  1, 0, null, null),
  (20, 'Hici AC - 7kW - Standard - 5m gun only',     'Hici',      'Spare parts',   1,  0, 1, null, null),
  (21, 'Hici AC - 7kW - Standard - 7m gun only',     'Hici',      'Spare parts',   4, 10, 0, 14,   20),
  (22, 'Hici AC - 22kW - Standard - 5m gun only',    'Hici',      'Spare parts',   0,  0, 0, null, null),
  (23, 'Hici AC - 22kW - Standard - 7m gun only',    'Hici',      'Spare parts',   1,  5, 0, 8,    10),
  (24, 'Hici DC Charger - 5m gun only',              'Hici',      'Spare parts',   1,  0, 0, null, null),
  (25, 'Hici DC Charger - 10 m gun only - Amphenol', 'Hici',      'Spare parts',   5,  0, 0, null, null),
  (26, 'Hici DC Charger - 10m gun only - Yihang',    'Hici',      'Spare parts',   3,  0, 0, null, null),
  (27, 'Hici - RNL',                                 'Hici',      'Spare parts',   3,  0, 0, null, null),
  (28, 'Hiconics - RNL',                             'Hici',      'Spare parts',   0,  0, 0, null, null),
  (29, 'Hici - Rectifier - 30kW (Power Meter)',      'Hici',      'Spare parts',   2,  0, 0, null, null),
  (30, 'Hici - Rectifier - 15kW',                    'Hici',      'Spare parts',   0,  0, 0, null, null),
  (31, 'Communication Protocal Convertor',           'Hici',      'Spare parts',   3,  0, 0, null, null),
  (32, 'Charging Connector and cable',               'Hici',      'Spare parts',   0,  0, 0, null, null),
  (33, 'RFID card - AC',                             'Hici',      'Accessories', 100,  0, 0, null, null),
  (34, 'RFID card - DC',                             'Hici',      'Accessories',  98,  0, 0, null, null),
  (35, 'Hici - DC - Charger Gun Holder',             'Hici',      'Accessories',   0,  0, 0, null, null),
  (36, 'Siemen - Parents - 7kW',                     'Siemens',   'Charger',      14,  0, 0, null, null),
  (37, 'Siemen - Child - 7kW',                       'Siemens',   'Charger',       6,  0, 0, null, null),
  (38, 'Schneider - 7kW',                            'Schneider', 'Charger',       2,  0, 0, null, null),
  (39, 'Schneider - 22kW',                           'Schneider', 'Charger',       2,  0, 0, null, null),
  (40, 'CCTV - Xiaomi CW400 Outdoor',                'Xiaomi',    'Accessories',   1,  0, 0, null, null),
  (41, 'AC Charger Stand',                           'Others',    'Accessories',  -2,  0, 0, null, null),
  (42, 'AC Charger Stand',                           'Hici',      'Accessories',  -2,  0, 0, null, null),
  (43, 'Bollard',                                    'Others',    'Accessories',  12,  0, 0, null, null),
  (44, 'Screen',                                     'Hici',      'Spare parts',   1,  0, 0, null, null),
  (45, 'Indicator light - Red',                      'Hici',      'Spare parts',   0,  0, 0, null, null),
  (46, 'Indicator light - Yellow',                   'Hici',      'Spare parts',   0,  0, 0, null, null),
  (47, 'Indicator light - Green',                    'Hici',      'Spare parts',   0,  0, 0, null, null)
),
ins as (
  insert into inv_items (name, brand, category, reorder_point, reorder_qty, sort_order)
  select name, brand, category, reorder_point, reorder_qty, row_no from src
  returning id, name, brand
)
insert into inv_movements (item_id, location_id, qty, kind, moved_on, note, created_by)
select i.id, l.id, v.qty, 'opening', date '2026-10-01',
       'Opening balance — migrated from Excel stock sheet (' || v.col || ')', 'Excel migration'
from src s
join ins i on i.name = s.name and i.brand = s.brand
cross join lateral (values ('TG', s.tg, 'Toh Guan (Now)'), ('PU', s.pu, 'PU (Now)'), ('SP', s.spoilt, 'Spoilt')) v(code, qty, col)
join inv_locations l on l.code = v.code
where v.qty <> 0;

-- Purchase requests (Microsoft Forms sheet). PR Number and Status were blank in
-- Excel: numbers assigned in sheet order, status 'legacy'.
with src (n, submitted_on, employee, department, company_project, delivery_address, item_name, qty, required_by, remarks, link_name) as (values
  (1,  date '2026-04-27', 'Ann',                        'Sales',     '3K',                                   '6 Ubi Road 1, #01-04, Wintech Centre', 'Hici AC - 7kW - Standard (5m)',                          10, date '2026-04-28', null, 'Hici AC - 7kW - Standard (5m)'),
  (2,  date '2026-04-27', 'Ann Cher',                   'Sales',     '3K',                                   '6 Ubi Road 1, #01-04, Wintech Centre', 'Hici AC - 22kW - Standard (5m)',                          5, date '2026-04-28', null, 'Hici AC - 22kW - Standard (5m)'),
  (3,  date '2026-04-27', 'Luqman',                     'Sales',     'Myco3 Logistics',                      'Self collect by Jason',                'Hici AC - 7kW - Standard (5m)',                           2, date '2026-04-29', null, 'Hici AC - 7kW - Standard (5m)'),
  (4,  date '2026-04-27', 'Ann Cher',                   'Sales',     'Gammon',                               'Tanah Merah Coast Road',               'Hici DC - 30kW - no gun',                                 2, date '2026-04-30', null, 'Hici DC - 30kW - no gun'),
  (5,  date '2026-04-27', 'Ann Cher',                   'Sales',     'SAC Solar',                            'To be confirm',                        'Hici AC - 22kW - Premium (7m)',                           4, date '2026-04-28', null, 'Hici AC - 22kW - Premium (7m)'),
  (6,  date '2026-04-27', 'Ann Cher',                   'Sales',     'SAC Solar',                            'TBA',                                  'Hici AC - 7kW - Premium (7m)',                            4, date '2026-04-28', null, 'Hici AC - 7kW - Premium (7m)'),
  (7,  date '2026-04-27', 'Ann Cher',                   'Sales',     'NTUC',                                 'Chai Chee and geylang',                'Hici AC - 22kW - Premium (7m)',                           2, date '2026-04-29', null, 'Hici AC - 22kW - Premium (7m)'),
  (8,  date '2026-04-27', 'Ann Cher',                   'Sales',     'Hohsay',                               'TBA',                                  'Hici AC - 22kW - Premium (7m)',                           1, date '2026-05-02', null, 'Hici AC - 22kW - Premium (7m)'),
  (9,  date '2026-04-30', 'Luqman Hakim',               'Sales',     'Steph Chung',                          'Self collect at Ubi',                  'Hici AC - 22kW - Standard (5m)',                          1, date '2026-05-04', 'Installer Mr Choo', 'Hici AC - 22kW - Standard (5m)'),
  (10, date '2026-05-04', 'Luqman',                     'Sales',     'Peak Engineering',                     '48 Toh Guan',                          'Hici - Control Module - ZM029',                           2, date '2026-07-04', 'Replacement part for Tower Transit (text partly cut off in the Excel cell)', null),
  (11, date '2026-05-06', 'Ann',                        'Sales',     '43 woodsville close',                  'TBA',                                  'Hici AC - 22kW - Standard (5m)',                          1, date '2026-05-11', null, 'Hici AC - 22kW - Standard (5m)'),
  (12, date '2026-05-07', 'Muhammad Danial bin khadam', 'Technical', 'Ethoz',                                '18 Pandan Rd, Singapore 609270',       'Hici - DC - Charger Gun Holder',                          2, date '2026-05-06', 'Nil', 'Hici - DC - Charger Gun Holder'),
  (13, date '2026-05-07', 'Luqman',                     'Sales',     'Suriya',                               'Self collect',                         'Hici - AC - RFID Card',                                  15, date '2026-05-08', null, 'RFID card - AC'),
  (14, date '2026-05-07', 'Ann',                        'CPO',       'CPO - EVe (Gul, Pandan, 20 ARC, 15 WLD)', 'TBA',                               'Hiconics - 120kW',                                        4, date '2026-06-30', null, 'Hiconics - 120kW'),
  (15, date '2026-05-07', 'Ann',                        'Sales',     'BNL',                                  'BNL Penjuru',                          'Hiconics - 120kW',                                        1, date '2026-06-30', null, 'Hiconics - 120kW'),
  (16, date '2026-05-08', 'Ann',                        'Sales',     'Netlink',                              'Netlink JE',                           'Hiconics - 120kW',                                        1, date '2026-05-19', null, 'Hiconics - 120kW'),
  (17, date '2026-05-08', 'Luqman',                     'Sales',     'Peak Engineering (Tower Transit)',     'Toh Guan office',                      'Hici - 250A Charging Connector (10m) - Phoenix Contact',  1, date '2026-07-08', 'Replacement gun for Charger 6 at Tower Transit Bulim', null),
  (18, date '2026-05-08', 'Luqman',                     'Sales',     'YLF Marketing',                        'Self collect',                         'Hici - DC - RFID Card',                                   2, date '2026-05-08', 'Ms Mwee', 'RFID card - DC'),
  (19, date '2026-05-11', 'Luqman',                     'Sales',     'Peak / Tower Transit Bulim',           '48 Toh Guan',                          'Hici - 250A Charging Connector (10m) - Phoenix Contact',  1, date '2026-07-11', null, null),
  (20, date '2026-05-11', 'Ann',                        'Sales',     '3K',                                   '3K',                                   'Hici AC - 7kW - Standard (5m)',                          15, date '2026-05-15', null, 'Hici AC - 7kW - Standard (5m)'),
  (21, date '2026-05-11', 'Ann Cher',                   'CPO',       '3K',                                   '3K',                                   'Hici AC - 22kW - Standard (5m)',                         10, date '2026-05-15', null, 'Hici AC - 22kW - Standard (5m)'),
  (22, date '2026-05-11', 'Luqman',                     'Sales',     'Quadunion',                            '21 Tuas Avenue 11',                    'Hiconics - 120kW',                                        1, null,              '120kw step down to 60kW. Customer ordered 60kW.', 'Hiconics - 120kW'),
  (23, date '2026-05-12', 'Jared',                      'Sales',     'J&Co Engineering',                     '45 Gul Drive',                         'Hici AC - 22kW - Premium (7m)',                           5, null,              null, 'Hici AC - 22kW - Premium (7m)'),
  (24, date '2026-05-12', 'Ann',                        'Sales',     'Wattrix',                              'Tuas - Mr Gao',                        'Hici AC - 7kW - Standard (5m)',                           1, null,              null, 'Hici AC - 7kW - Standard (5m)'),
  (25, date '2026-05-15', 'Luqman',                     'Sales',     'Wee built',                            'Self collect Toh Guan',                'Hici AC - 7kW - Standard (5m)',                           2, null,              null, 'Hici AC - 7kW - Standard (5m)'),
  (26, date '2026-05-26', 'jiang',                      'Technical', '30kw',                                 '48 Toh Guan Rd',                       'Hici - SoilTech - Rusty Parts',                           4, null,              null, null),
  (27, date '2026-06-05', 'Luqman',                     'Sales',     'Tower Transit (Peak Engineering)',     '48 Toh Guan Road',                     'Hici - 250A Charging Connector (10m) - Phoenix Contact',  1, null,              null, null),
  (28, date '2026-06-11', 'Ann Cher',                   'Sales',     'Liam Seng Hin (Contractor: FineBuild)', '121 Neythal Road',                    'Hiconics - 120kW',                                        2, date '2026-07-17', null, 'Hiconics - 120kW'),
  (29, date '2026-06-11', 'Ann Cher',                   'Sales',     'Lian Seng Hin - FineBuild',            '121 Neythal Road',                     'Hici AC - 22kW - Standard (5m)',                          4, date '2026-07-17', null, 'Hici AC - 22kW - Standard (5m)'),
  (30, date '2026-06-15', 'Luqman',                     'Sales',     'Completion Products',                  '1 Tuas Avenue 12',                     'Hiconics - 120kW',                                        1, date '2026-07-15', 'PO received. 120kW tuned down to 80kW.', 'Hiconics - 120kW')
)
insert into inv_requests (pr_no, submitted_on, employee, department, company_project, delivery_address, item_id, item_name, qty, required_by, remarks, status, created_by)
select 'PR-2026-' || lpad(s.n::text, 4, '0'), s.submitted_on, s.employee, s.department, s.company_project, s.delivery_address,
       (select id from inv_items i where i.name = s.link_name limit 1), s.item_name, s.qty, s.required_by, s.remarks, 'legacy', 'Excel migration'
from src s;

-- Incoming shipment tracker. Item links are the best match for each description.
with src (legacy_no, supplier, po_no, customer, description, qty, order_date, in_transit_date, eta, eta_note, status, notes, link_name, link_brand) as (values
  (1,  'HICI',     'EV1PO-000226',       null,        '5 unit 7kw 5meter standard (Replacement)',                         5, date '2026-03-02', null::date,        date '2026-06-16', '16/06 - 17/06', 'received',   null, 'Hici AC - 7kW - Standard (5m)', 'Hici'),
  (2,  'HICI',     'EV1PO-000228',       null,        '30 unit 7kw 5meter standard',                                     30, date '2026-03-11', null,              date '2026-06-16', '16/06 - 17/06', 'received',   null, 'Hici AC - 7kW - Standard (5m)', 'Hici'),
  (3,  'HICI',     'EV1PO-000228',       null,        '30 unit 22kw black premium',                                      30, date '2026-03-11', null,              date '2026-06-16', '16/06 - 17/06', 'received',   null, 'Hici AC - 22kW - Premium (7m)', 'Hici'),
  (4,  'HICI',     'EV1PO-000231',       null,        '50 unit 7kw 5meter standard',                                     50, date '2026-03-27', null,              date '2026-06-16', '16/06 - 17/06', 'received',   null, 'Hici AC - 7kW - Standard (5m)', 'Hici'),
  (5,  'HICI',     'EV1PO-000231',       null,        '10 unit 22kw 5meter standard',                                    10, date '2026-03-27', null,              date '2026-06-16', '16/06 - 17/06', 'received',   null, 'Hici AC - 22kW - Standard (5m)', 'Hici'),
  (6,  'HICI',     'EV1PO-000235',       null,        'Model: HK-H30-1000-BE1',                                           1, date '2026-04-24', null,              date '2026-07-16', null,            'received',   null, 'Hici DC - 30kW - 7m gun', 'Hici'),
  (7,  'HICI',     'EV1PO-000235',       null,        'Model: HK-H30-1000-BE1',                                           1, date '2026-04-24', null,              date '2026-07-16', null,            'received',   null, 'Hici DC - 30kW - 7m gun', 'Hici'),
  (8,  'HICI',     'EV1PO-000235',       null,        'Model: HK-H30-1000-BE1',                                           1, date '2026-04-24', null,              date '2026-07-16', null,            'received',   null, 'Hici DC - 30kW - 7m gun', 'Hici'),
  (9,  'HICI',     'EV1PO-000236',       null,        '5 unit 200A 10m charging connector and cable (Amphenol)',          5, date '2026-05-12', null,              date '2026-07-16', null,            'received',   null, 'Hici DC Charger - 10 m gun only - Amphenol', 'Hici'),
  (10, 'HICI',     'EV1PO-000236',       null,        '3 unit 250A 10m charging connector and cable (Yihang)',            3, date '2026-05-12', null,              date '2026-07-16', null,            'received',   null, 'Hici DC Charger - 10m gun only - Yihang', 'Hici'),
  (11, 'HICI',     'EV1PO-000238 (244)', null,        'Model: HK-EE-60-A1 - two 8m connectors (60kwh)',                   1, date '2026-05-19', null,              null,              'TBC',           'ordered',    'Status was blank in Excel. Note: the Goods Received log shows a 60kW (Hici DC - 60kW - 7m gun) received on 16/07/26 — check whether this shipment already arrived before receiving it here.', 'Hici DC - 60kW - 7m gun', 'Hici'),
  (12, 'HICI',     'EV1PO-000240',       null,        'HICI Screen - code: 8118000611 - Model: LMT070DICFWD-AKA',         1, date '2026-05-21', null,              date '2026-07-16', null,            'received',   null, 'Screen', 'Hici'),
  (13, 'HICI',     'EV1PO-000241',       null,        '65 unit 7kw 5meter standard',                                     65, date '2026-06-03', null,              date '2026-08-13', null,            'received',   null, 'Hici AC - 7kW - Standard (5m)', 'Hici'),
  (14, 'HICI',     'EV1PO-000241',       null,        '30 unit 22kw 5meter standard',                                    30, date '2026-06-03', null,              date '2026-08-13', null,            'received',   null, 'Hici AC - 22kW - Standard (5m)', 'Hici'),
  (15, 'HICI',     'EV1PO-000241',       null,        '15 unit 22kw black premium',                                      15, date '2026-06-03', null,              date '2026-08-13', null,            'received',   null, 'Hici AC - 22kW - Premium (7m)', 'Hici'),
  (16, 'HICI',     'EV1PO-000241',       null,        '10 unit 7kw black premium',                                       10, date '2026-06-03', null,              date '2026-08-13', null,            'received',   null, 'Hici AC - 7kW - Premium (7m)', 'Hici'),
  (17, 'HICI',     'EV1PO-000241',       null,        '10 unit 7KW AC Cable - 7meter',                                   10, date '2026-06-03', null,              date '2026-08-13', null,            'received',   null, 'Hici AC - 7kW - Standard - 7m gun only', 'Hici'),
  (18, 'HICI',     'EV1PO-000241',       null,        '5 unit 22KW AC Cable - 7meter',                                    5, date '2026-06-03', null,              date '2026-08-13', null,            'received',   null, 'Hici AC - 22kW - Standard - 7m gun only', 'Hici'),
  (19, 'Hiconics', 'EV1PO-000232',       null,        '5 unit L120kW-EN',                                                 5, date '2026-04-08', date '2026-06-22', date '2026-07-01', null,            'received',   'In transit date 22/06 (ETD)', 'Hiconics - 120kW', 'Hiconics'),
  (20, 'Hiconics', 'EV1PO-000239',       null,        '3 unit L120kW-EN',                                                 3, date '2026-05-20', null,              date '2026-08-11', null,            'received',   null, 'Hiconics - 120kW', 'Hiconics'),
  (21, 'HICI',     'EV1PO-000243',       null,        '2 units INDICATOR LIGHT (RED)  PART NO.1116300150',                2, date '2026-06-12', null,              date '2026-09-22', null,            'received',   'Excel tracker says Received, but the Goods Received log still shows these as in transit (not counted into stock).', 'Indicator light - Red', 'Hici'),
  (22, 'HICI',     'EV1PO-000243',       null,        '4 units INDICATOR LIGHT (YELLOW)  PART NO.1116300160',             4, date '2026-06-12', null,              date '2026-09-22', null,            'received',   'Excel tracker says Received, but the Goods Received log still shows these as in transit (not counted into stock).', 'Indicator light - Yellow', 'Hici'),
  (23, 'HICI',     'EV1PO-000243',       null,        '2 units INDICATOR LIGHT (GREEN) PART NO.1116300140',               2, date '2026-06-12', null,              date '2026-09-22', null,            'received',   'Excel tracker says Received, but the Goods Received log still shows these as in transit (not counted into stock).', 'Indicator light - Green', 'Hici'),
  (30, 'HICI',     'EV1PO-000244',       'Chuan Lim', '2 units HK-EE-180-A1V 180kW CCS2 EV Charger',                      2, date '2026-06-18', null,              date '2026-09-22', null,            'received',   null, 'Hici DC - 180kW - 7m gun', 'Hici'),
  (31, 'HICI',     'EV1PO-000245',       null,        '200 units RFID Card - AC Charger',                               200, date '2026-07-13', null,              null,              null,            'in_transit', null, 'RFID card - AC', 'Hici'),
  (32, 'HICI',     'EV1PO-000247',       null,        '5 units AC Charger Stand pole',                                    5, date '2026-07-31', null,              null,              null,            'ordered',    'Status was blank in Excel.', 'AC Charger Stand', 'Hici'),
  (33, 'HICI',     'EV1PO-000248',       null,        '100 unit RFID CARD - AC CHARGER',                                100, date '2026-08-05', null,              null,              null,            'ordered',    'Status was blank in Excel.', 'RFID card - AC', 'Hici'),
  (34, 'Hiconics', 'EV1PO-000246',       null,        '2 unit L120kW-EN',                                                 2, date '2026-07-21', null,              null,              null,            'ordered',    'Status was blank in Excel.', 'Hiconics - 120kW', 'Hiconics')
)
insert into inv_shipments (legacy_no, supplier, po_no, customer, description, item_id, qty, order_date, in_transit_date, eta, eta_note,
                           status, received_on, notes, legacy, created_by)
select s.legacy_no, s.supplier, s.po_no, s.customer, s.description,
       (select id from inv_items i where i.name = s.link_name and i.brand = s.link_brand limit 1),
       s.qty, s.order_date, s.in_transit_date, s.eta, s.eta_note, s.status,
       case when s.status = 'received' then s.eta end, s.notes, true, 'Excel migration'
from src s;

-- Goods received log. Already-received lines are history (posted = false).
-- The 3 indicator-light lines were still in transit → pending.
with src (seq, received_on, supplier, item_name, qty_ordered, qty_received, loc_code, status, notes) as (values
  (1,  date '2026-04-27', 'Hici',     'Hici AC - 22kW - Premium (7m)',              30,   25,   'TG', 'received', 'Excel date "27-Apr" (no year) — taken as 2026'),
  (2,  date '2026-04-27', 'Hici',     'Hici AC - 7kW - Standard (5m)',              20,   20,   'TG', 'received', 'Excel date "27-Apr" (no year) — taken as 2026'),
  (3,  date '2026-04-27', 'Hici',     'Communication Protocal Convertor',            3,    3,   'TG', 'received', 'Excel date "27-Apr" (no year) — taken as 2026'),
  (4,  date '2026-04-27', 'Hici',     'RFID card - AC',                            100,  100,   'TG', 'received', 'Excel date "27-Apr" (no year) — taken as 2026'),
  (5,  date '2026-04-27', 'Hici',     'RFID card - DC',                            100,  100,   'TG', 'received', 'Excel date "27-Apr" (no year) — taken as 2026'),
  (6,  date '2026-04-27', 'Hici',     'Hici DC Charger - 7m gun only',               2,    2,   'TG', 'received', 'Excel date "27-Apr" (no year) — taken as 2026. No matching item in the stock sheet.'),
  (7,  date '2026-04-27', 'Hici',     'Hici DC - 120kW - 7m gun',                    1,    1,   'TG', 'received', 'Excel date "27-Apr" (no year) — taken as 2026'),
  (8,  date '2026-04-27', 'Hici',     'Hici DC - 30kW - no gun',                     2,    2,   'TG', 'received', 'Excel date "27-Apr" (no year) — taken as 2026'),
  (9,  date '2026-04-27', 'Hici',     'Hici DC - 30kW - 7m gun',                     2,    2,   'TG', 'received', 'Excel date "27-Apr" (no year) — taken as 2026'),
  (10, date '2026-04-27', 'Hici',     'Hici DC - 30kW Standing Pole',                2,    2,   'TG', 'received', 'Excel date "27-Apr" (no year) — taken as 2026'),
  (11, date '2026-07-01', 'Hiconics', 'Hiconics - 120kW',                            5,    5,   'PU', 'received', null),
  (12, date '2026-06-16', 'Hici',     'Hici AC - 7kW - Standard (5m)',              80,   85,   'TG', 'received', null),
  (13, date '2026-06-16', 'Hici',     'Hici AC - 22kW - Premium (7m)',              30,   30,   'TG', 'received', null),
  (14, date '2026-06-16', 'Hici',     'Hici AC - 22kW - Standard (5m)',             10,   10,   'TG', 'received', 'Excel location "toh gun" — read as Toh Guan'),
  (15, date '2026-07-16', 'Hici',     'Hici DC - 30kW - 7m gun',                     3,    3,   'TG', 'received', null),
  (16, date '2026-07-16', 'Hici',     'Hici DC - 60kW - 7m gun',                     1,    1,   'TG', 'received', null),
  (17, date '2026-07-16', 'Hici',     'Hici DC Charger - 10 m gun only - Amphenol',  5,    5,   'TG', 'received', null),
  (18, date '2026-07-16', 'Hici',     'Hici DC Charger - 10m gun only - Yihang',     3,    3,   'TG', 'received', null),
  (19, date '2026-07-16', 'Hici',     'Screen',                                      1,    1,   'TG', 'received', null),
  (20, date '2026-08-11', 'Hiconics', 'Hiconics - 120kW',                            3,    3,   'PU', 'received', 'Excel date "08/11/2026" read month-first (11 Aug) — matches the shipment ETA of 11-Aug-26'),
  (21, date '2026-08-13', 'Hici',     'Hici AC - 7kW - Standard (5m)',              65,   65,   'PU', 'received', null),
  (22, date '2026-08-13', 'Hici',     'Hici AC - 22kW - Standard (5m)',             30,   30,   'PU', 'received', null),
  (23, date '2026-08-13', 'Hici',     'Hici AC - 7kW - Premium (7m)',               10,   10,   'PU', 'received', null),
  (24, date '2026-08-13', 'Hici',     'Hici AC - 22kW - Premium (7m)',              15,   15,   'PU', 'received', null),
  (25, date '2026-08-13', 'Hici',     'Hici AC - 7kW - Standard - 7m gun only',     10,   10,   'PU', 'received', null),
  (26, date '2026-08-13', 'Hici',     'Hici AC - 22kW - Standard - 7m gun only',     5,    5,   'PU', 'received', null),
  (27, null,              'Hici',     'Indicator light - Red',                       2, null, null, 'pending',  'Still in transit in Excel (date shown "06/12/2026" = the 12 Jun order date). Shipment EV1PO-000243.'),
  (28, null,              'Hici',     'Indicator light - Yellow',                    4, null, null, 'pending',  'Still in transit in Excel (date shown "06/12/2026" = the 12 Jun order date). Shipment EV1PO-000243.'),
  (29, null,              'Hici',     'Indicator light - Green',                     2, null, null, 'pending',  'Still in transit in Excel (date shown "06/12/2026" = the 12 Jun order date). Shipment EV1PO-000243.'),
  (30, null,              null,       'Bollard',                                    20,   20,   'TG', 'received', 'No date or supplier in Excel')
)
insert into inv_grn (received_on, supplier, item_id, item_name, qty_ordered, qty_received, location_id, notes, status, posted, legacy, created_by, created_at)
select s.received_on, s.supplier,
       (select id from inv_items i where i.name = s.item_name limit 1),
       s.item_name, s.qty_ordered, s.qty_received,
       (select id from inv_locations l where l.code = s.loc_code), s.notes, s.status, false, true, 'Excel migration',
       timestamptz '2026-10-01 00:00:00+08' + make_interval(secs => s.seq)
from src s;

-- Tie the 3 pending indicator-light receipts to their shipment lines (PO EV1PO-000243).
update inv_grn g set shipment_id = s.id, po_no = s.po_no
from inv_shipments s
where g.status = 'pending' and s.po_no = 'EV1PO-000243' and s.item_id = g.item_id;
