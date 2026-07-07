import { useState } from 'react';
import { Download as DownloadIcon } from 'lucide-react';
import {
  Document,
  Page,
  View,
  Text,
  Image as PDFImage,
  StyleSheet,
  PDFViewer,
  Font,
  Svg,
  Path,
  pdf,
} from '@react-pdf/renderer';
import logoSrc from '../../assets/evone-logo.png';
import figtree400 from '@fontsource/figtree/files/figtree-latin-400-normal.woff';
import figtree500 from '@fontsource/figtree/files/figtree-latin-500-normal.woff';
import figtree600 from '@fontsource/figtree/files/figtree-latin-600-normal.woff';
import figtree700 from '@fontsource/figtree/files/figtree-latin-700-normal.woff';

// Register Figtree so the PDF uses the same brand typography as the app
Font.register({
  family: 'Figtree',
  fonts: [
    { src: figtree400, fontWeight: 400 },
    { src: figtree500, fontWeight: 500 },
    { src: figtree600, fontWeight: 600 },
    { src: figtree700, fontWeight: 700 },
  ],
});
import { C } from '../../theme';
import { isOverlay, pagesOf } from './OverlayForm';
import type { FormField, FormTemplate, FormValues, OverlayPage, WorkOrder, WorkOrderForm } from '../../workOrderStore';

// ─── Brand tokens scoped to react-pdf (no media queries / no `var`) ──

const PDF_GREEN = '#2A9A47';
const PDF_HONEYDEW = '#E6F4EA';
const PDF_SLATE = '#5B6B7A';
const PDF_LINE = '#EBEBEB';
const PDF_LINE_LIGHT = '#F3F3F3';
const PDF_DANGER = '#C0321A';

// A4 page geometry (points: 1pt = 1/72 inch)
const PAGE_PADDING = 40;
const PAGE_CONTENT_WIDTH = 595 - PAGE_PADDING * 2; // 515 pt

const styles = StyleSheet.create({
  page: {
    paddingTop: PAGE_PADDING,
    paddingBottom: PAGE_PADDING + 32, // leave room for fixed footer
    paddingHorizontal: PAGE_PADDING,
    fontSize: 10,
    color: '#1a1a1a',
    fontFamily: 'Figtree',
    lineHeight: 1.4,
  },

  // Letterhead
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: 10,
    marginBottom: 16,
    borderBottomWidth: 2,
    borderBottomColor: PDF_GREEN,
  },
  logo: { width: 70, marginRight: 14 },
  headerCenter: { flex: 1, paddingRight: 8 },
  templateName: {
    fontSize: 13,
    fontFamily: 'Figtree',
    fontWeight: 700,
    color: PDF_GREEN,
    letterSpacing: 0.4,
  },
  templateDesc: { fontSize: 9, color: PDF_SLATE, marginTop: 2 },
  headerMeta: { fontSize: 9, color: PDF_SLATE, textAlign: 'right' },
  metaLine: { marginBottom: 2 },
  metaLabel: { fontFamily: 'Figtree', fontWeight: 700, color: '#1a1a1a' },

  // Section + fields (structured)
  section: {
    marginTop: 12,
    marginBottom: 8,
    paddingBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: PDF_LINE,
    fontFamily: 'Figtree',
    fontWeight: 700,
    fontSize: 11,
    color: PDF_GREEN,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  field: { marginBottom: 8 },
  fieldLabel: {
    fontSize: 8,
    color: PDF_SLATE,
    fontFamily: 'Figtree',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 2,
  },
  fieldValue: {
    fontSize: 11,
    paddingVertical: 4,
    paddingHorizontal: 6,
    backgroundColor: '#FAFAFA',
    borderWidth: 1,
    borderColor: PDF_LINE,
    borderRadius: 3,
    minHeight: 18,
  },
  fieldValueRequiredEmpty: {
    borderColor: PDF_DANGER,
    color: PDF_DANGER,
  },
  requiredStar: { color: PDF_DANGER, marginLeft: 3 },

  // Checkbox row (structured)
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
    paddingVertical: 4,
    paddingHorizontal: 6,
    backgroundColor: PDF_HONEYDEW,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: PDF_LINE,
  },
  checkboxRowUnchecked: {
    backgroundColor: '#FAFAFA',
  },
  checkboxBox: {
    width: 11,
    height: 11,
    marginRight: 8,
    borderWidth: 1,
    borderColor: PDF_SLATE,
    borderRadius: 2,
  },
  checkboxBoxChecked: {
    backgroundColor: PDF_GREEN,
    borderColor: PDF_GREEN,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxLabel: { fontSize: 10, flex: 1 },

  // Overlay layout
  overlayWrap: {
    position: 'relative',
    alignSelf: 'center',
  },
  overlayImage: { width: '100%', height: '100%' },
  overlayCell: {
    position: 'absolute',
    paddingHorizontal: 2,
    paddingVertical: 1,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  overlayText: {
    fontSize: 9,
    color: '#1a1a1a',
  },
  overlayCheckEmpty: {
    width: '70%',
    height: '70%',
    borderWidth: 1,
    borderColor: PDF_SLATE,
    borderRadius: 1,
    alignSelf: 'center',
  },
  overlayCheckFilled: {
    width: '70%',
    height: '70%',
    backgroundColor: PDF_GREEN,
    borderRadius: 1,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Footer
  footer: {
    position: 'absolute',
    bottom: 24,
    left: PAGE_PADDING,
    right: PAGE_PADDING,
    flexDirection: 'row',
    justifyContent: 'space-between',
    fontSize: 8,
    color: PDF_SLATE,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: PDF_LINE_LIGHT,
  },

  // Audit
  audit: {
    marginTop: 18,
    padding: 8,
    backgroundColor: PDF_HONEYDEW,
    borderRadius: 4,
    fontSize: 9,
    color: PDF_SLATE,
  },
  auditTitle: {
    fontFamily: 'Figtree',
    fontWeight: 700,
    color: '#1a1a1a',
    marginBottom: 2,
    fontSize: 9,
  },
});

// ─── Helpers ──────────────────────────────────────────────────────

function CheckMark({ size = 9 }: { size?: number }) {
  return (
    <Svg viewBox="0 0 16 16" width={size} height={size}>
      <Path
        d="M3.2 8.4 L6.4 11.6 L12.8 4.6"
        stroke="#ffffff"
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}

function stringValue(values: FormValues, id: string): string {
  const v = values[id];
  return typeof v === 'string' ? v : '';
}

// ─── Document component ──────────────────────────────────────────

export function WorkOrderDocument({
  workOrder,
  forms,
  getTemplate,
}: {
  workOrder: WorkOrder;
  forms: WorkOrderForm[];
  getTemplate: (id: string) => FormTemplate | undefined;
}) {
  const docForms = forms
    .map((f) => ({ f, t: getTemplate(f.templateId) }))
    .filter((x): x is { f: WorkOrderForm; t: FormTemplate } => !!x.t);

  // Flatten to printable pages: a structured form is one page; an overlay form
  // expands to one page per uploaded form page.
  type DocPage = { f: WorkOrderForm; t: FormTemplate; overlay: boolean; page?: OverlayPage; pageIndex: number; pageCount: number };
  const docPages: DocPage[] = docForms.flatMap(({ f, t }): DocPage[] => {
    if (isOverlay(t)) {
      const pgs = pagesOf(t);
      return pgs.map((op, i) => ({ f, t, overlay: true, page: op, pageIndex: i, pageCount: pgs.length }));
    }
    return [{ f, t, overlay: false, page: undefined, pageIndex: 0, pageCount: 1 }];
  });

  return (
    <Document
      title={`${workOrder.id} · ${workOrder.customer}`}
      author="EVOne Sdn Bhd"
      creator="EVOne TSD"
    >
      {docPages.map(({ f, t, overlay, page, pageIndex, pageCount }) => {
        const values = f.values ?? {};
        const subtitle = pageCount > 1
          ? `${f.label} — page ${pageIndex + 1} of ${pageCount}`
          : (docForms.length > 1 ? f.label : t.description);
        return (
          <Page key={`${f.id}-${pageIndex}`} size="A4" style={styles.page}>
            {/* Letterhead */}
            <View style={styles.header} fixed>
              <PDFImage src={logoSrc} style={styles.logo} />
              <View style={styles.headerCenter}>
                <Text style={styles.templateName}>{t.name}</Text>
                {subtitle ? <Text style={styles.templateDesc}>{subtitle}</Text> : null}
              </View>
              <View style={styles.headerMeta}>
                <Text style={styles.metaLine}><Text style={styles.metaLabel}>Ref: </Text>{workOrder.id}</Text>
                <Text style={styles.metaLine}><Text style={styles.metaLabel}>Customer: </Text>{workOrder.customer}</Text>
                <Text style={styles.metaLine}><Text style={styles.metaLabel}>Scheduled: </Text>{workOrder.scheduledDate}</Text>
                <Text style={styles.metaLine}><Text style={styles.metaLabel}>Technician: </Text>{workOrder.assignedTo ?? '—'}</Text>
              </View>
            </View>

            {/* Body */}
            {overlay && page
              ? <OverlayBody page={page} fields={t.fields.filter((fl: FormField) => (fl.page ?? 0) === pageIndex)} values={values} />
              : <StructuredBody template={t} values={values} />}

            {/* Audit */}
            {workOrder.response && (
              <View style={styles.audit} wrap={false}>
                <Text style={styles.auditTitle}>Audit trail</Text>
                {workOrder.response.submittedBy && (
                  <Text>Submitted by {workOrder.response.submittedBy} on {workOrder.response.submittedAt}</Text>
                )}
                {workOrder.response.editedBy && (
                  <Text>Edited by {workOrder.response.editedBy} on {workOrder.response.editedAt}</Text>
                )}
                {workOrder.status === 'completed' && <Text>Approved & marked completed.</Text>}
              </View>
            )}

            {/* Footer */}
            <View style={styles.footer} fixed>
              <Text>EVOne Sdn Bhd · evone.com.my</Text>
              <Text render={({ pageNumber, totalPages }) => `${workOrder.id} · Page ${pageNumber} of ${totalPages}`} />
            </View>
          </Page>
        );
      })}
    </Document>
  );
}

// ─── Structured body ─────────────────────────────────────────────

function StructuredBody({
  template,
  values,
}: {
  template: FormTemplate;
  values: FormValues;
}) {
  return (
    <View>
      {template.fields.map((f) => (
        <StructuredField key={f.id} field={f} values={values} />
      ))}
    </View>
  );
}

function StructuredField({
  field,
  values,
}: {
  field: FormField;
  values: FormValues;
}) {
  if (field.type === 'section') {
    return <Text style={styles.section}>{field.label}</Text>;
  }

  if (field.type === 'checkbox') {
    const checked = values[field.id] === true;
    return (
      <View
        style={checked ? styles.checkboxRow : [styles.checkboxRow, styles.checkboxRowUnchecked]}
        wrap={false}
      >
        <View style={checked ? [styles.checkboxBox, styles.checkboxBoxChecked] : styles.checkboxBox}>
          {checked && <CheckMark />}
        </View>
        <Text style={styles.checkboxLabel}>{field.label}</Text>
      </View>
    );
  }

  if (field.type === 'group' && field.children) {
    // Two columns: the non-photo fields (numbers / text) on the left, and up to 4 photos
    // in a 2x2 grid on the right.
    const photoChildren = field.children.filter((c) => c.type === 'photo');
    const otherChildren = field.children.filter((c) => c.type !== 'photo');
    const photos = photoChildren
      .map((c) => ({ child: c, src: stringValue(values, c.id) }))
      .filter((p) => !!p.src)
      .slice(0, 4);
    const hasPhotos = photos.length > 0;
    return (
      <View style={styles.field} wrap={false}>
        <Text style={[styles.fieldLabel, { fontSize: 9, marginBottom: 2 }]}>{field.label}</Text>
        <View style={{ flexDirection: 'row', paddingLeft: 8, borderLeftWidth: 1.5, borderLeftColor: '#E4F3E3' }}>
          <View style={{ flex: 1, marginRight: hasPhotos ? 10 : 0 }}>
            {otherChildren.map((c) => (
              <StructuredField key={c.id} field={c} values={values} />
            ))}
          </View>
          {hasPhotos && (
            <View style={{ width: 232, flexDirection: 'row', flexWrap: 'wrap' }}>
              {photos.map((p) => (
                <View key={p.child.id} style={{ width: '50%', padding: 2 }}>
                  <Text style={[styles.fieldLabel, { fontSize: 7, marginBottom: 2 }]}>{p.child.label}</Text>
                  <PDFImage src={p.src} style={{ width: '100%', height: 96, borderRadius: 4, objectFit: 'cover' }} />
                </View>
              ))}
            </View>
          )}
        </View>
      </View>
    );
  }

  if (field.type === 'group') {
    const checked = values[field.id] === true;
    const photo = stringValue(values, `${field.id}::photo`);
    const remark = stringValue(values, `${field.id}::remark`);
    return (
      <View wrap={false} style={styles.field}>
        <View style={checked ? styles.checkboxRow : [styles.checkboxRow, styles.checkboxRowUnchecked]}>
          <View style={checked ? [styles.checkboxBox, styles.checkboxBoxChecked] : styles.checkboxBox}>
            {checked && <CheckMark />}
          </View>
          <Text style={styles.checkboxLabel}>{field.label}</Text>
        </View>
        {photo ? (
          <View style={{ marginTop: 6 }}>
            <Text style={styles.fieldLabel}>{field.photoLabel || 'Photo'}</Text>
            <PDFImage src={photo} style={{ width: 200, marginTop: 4, borderRadius: 4 }} />
          </View>
        ) : null}
        {remark ? (
          <View style={{ marginTop: 6 }}>
            <Text style={styles.fieldLabel}>{field.remarkLabel || 'Remarks'}</Text>
            <Text style={styles.fieldValue}>{remark}</Text>
          </View>
        ) : null}
      </View>
    );
  }

  const value = stringValue(values, field.id);
  const isMissing = !!field.required && !value;

  if (field.type === 'photo') {
    return (
      <View style={styles.field} wrap={false}>
        <Text style={styles.fieldLabel}>
          {field.label}
          {field.required ? <Text style={styles.requiredStar}> *</Text> : ''}
        </Text>
        {value
          ? <PDFImage src={value} style={{ width: 240, marginTop: 4, borderRadius: 4 }} />
          : <Text style={isMissing ? [styles.fieldValue, styles.fieldValueRequiredEmpty] : styles.fieldValue}>{isMissing ? '— required —' : '— no photo —'}</Text>}
      </View>
    );
  }

  if (field.type === 'signature') {
    return (
      <View style={styles.field} wrap={false}>
        <Text style={styles.fieldLabel}>
          {field.label}
          {field.required ? <Text style={styles.requiredStar}> *</Text> : ''}
        </Text>
        {value
          ? <PDFImage src={value} style={{ width: 200, marginTop: 4, borderBottomWidth: 1, borderBottomColor: PDF_SLATE }} />
          : <Text style={isMissing ? [styles.fieldValue, styles.fieldValueRequiredEmpty] : styles.fieldValue}>{isMissing ? '— required —' : '— not signed —'}</Text>}
      </View>
    );
  }

  return (
    <View style={styles.field} wrap={false}>
      <Text style={styles.fieldLabel}>
        {field.label}
        {field.required ? <Text style={styles.requiredStar}> *</Text> : ''}
      </Text>
      <Text style={isMissing ? [styles.fieldValue, styles.fieldValueRequiredEmpty] : styles.fieldValue}>
        {value || (isMissing ? '— required —' : ' ')}
      </Text>
    </View>
  );
}

// ─── Overlay body ────────────────────────────────────────────────

function OverlayBody({
  page,
  fields,
  values,
}: {
  page: OverlayPage;
  fields: FormField[];
  values: FormValues;
}) {
  if (!page.imageSrc) {
    return (
      <View style={{ padding: 20, alignItems: 'center' }}>
        <Text style={{ color: PDF_SLATE }}>No form image attached.</Text>
      </View>
    );
  }

  // Compute the image's display dimensions in points so that absolute-positioned
  // children can use percentages. Page content area is PAGE_CONTENT_WIDTH wide.
  const aspect =
    page.imageWidth && page.imageHeight
      ? page.imageWidth / page.imageHeight
      : 210 / 297;
  const displayWidth = PAGE_CONTENT_WIDTH;
  const displayHeight = displayWidth / aspect;

  return (
    <View
      style={[
        styles.overlayWrap,
        { width: displayWidth, height: displayHeight },
      ]}
    >
      <PDFImage src={page.imageSrc} style={styles.overlayImage} />
      {fields.map((f) => (
        <OverlayField key={f.id} field={f} values={values} />
      ))}
    </View>
  );
}

function OverlayField({
  field,
  values,
}: {
  field: FormField;
  values: FormValues;
}) {
  const left = `${field.x ?? 0}%`;
  const top = `${field.y ?? 0}%`;
  const width = `${field.width ?? 10}%`;
  const height = `${field.height ?? 5}%`;

  if (field.type === 'checkbox') {
    const checked = values[field.id] === true;
    return (
      <View
        style={[
          styles.overlayCell,
          { left, top, width, height, alignItems: 'center' },
        ]}
      >
        <View style={checked ? styles.overlayCheckFilled : styles.overlayCheckEmpty}>
          {checked && <CheckMark />}
        </View>
      </View>
    );
  }

  const value = stringValue(values, field.id);

  if ((field.type === 'photo' || field.type === 'signature') && value) {
    return (
      <View style={[styles.overlayCell, { left, top, width, height, padding: 0 }]}>
        <PDFImage src={value} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
      </View>
    );
  }

  return (
    <View
      style={[
        styles.overlayCell,
        { left, top, width, height },
      ]}
    >
      <Text style={styles.overlayText}>{value}</Text>
    </View>
  );
}

// ─── Preview modal ───────────────────────────────────────────────

interface PDFPreviewModalProps {
  workOrder: WorkOrder;
  forms: WorkOrderForm[];
  getTemplate: (id: string) => FormTemplate | undefined;
  onClose: () => void;
}

export function PDFPreviewModal({
  workOrder,
  forms,
  getTemplate,
  onClose,
}: PDFPreviewModalProps) {
  const [downloading, setDownloading] = useState(false);

  const fileBase = `${workOrder.id} ${workOrder.customer}`
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, '_');
  const fileName = `${fileBase}.pdf`;

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const blob = await pdf(
        <WorkOrderDocument workOrder={workOrder} forms={forms} getTemplate={getTemplate} />,
      ).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      // give the browser a tick to start the download before we revoke
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(20,20,20,0.86)',
        zIndex: 2000,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Action bar */}
      <div
        style={{
          background: '#1a1a1a',
          padding: '14px 24px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          color: C.white,
          flexShrink: 0,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '-0.01em' }}>
            PDF Preview
          </div>
          <div style={{ fontSize: 11, opacity: 0.7 }}>
            {workOrder.id} · {workOrder.customer} · {forms.length} form{forms.length === 1 ? '' : 's'}
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.6)', marginRight: 6 }}>
            Rendered with @react-pdf/renderer · preview = download
          </span>
          <button
            onClick={onClose}
            style={{
              padding: '8px 14px',
              borderRadius: 8,
              border: '1px solid rgba(255,255,255,0.22)',
              background: 'transparent',
              color: C.white,
              fontFamily: 'Figtree',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Close
          </button>
          <button
            onClick={handleDownload}
            disabled={downloading}
            style={{
              padding: '8px 18px',
              borderRadius: 8,
              border: 'none',
              background: downloading ? '#7BB985' : C.green,
              color: C.white,
              fontFamily: 'Figtree',
              fontSize: 13,
              fontWeight: 700,
              cursor: downloading ? 'progress' : 'pointer',
            }}
          >
            {downloading ? 'Preparing…' : <><DownloadIcon size={12} strokeWidth={2.25} style={{ display: 'inline', verticalAlign: '-2px', marginRight: 4 }}/> Download PDF</>}
          </button>
        </div>
      </div>

      {/* PDF viewer */}
      <div
        style={{
          flex: 1,
          background: '#3a3a3a',
          padding: 16,
          overflow: 'hidden',
        }}
      >
        <PDFViewer
          showToolbar={false}
          style={{ width: '100%', height: '100%', border: 'none', borderRadius: 8 }}
        >
          <WorkOrderDocument workOrder={workOrder} forms={forms} getTemplate={getTemplate} />
        </PDFViewer>
      </div>
    </div>
  );
}
