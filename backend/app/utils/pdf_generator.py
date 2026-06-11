import io
import logging
from datetime import datetime
from typing import Any

logger = logging.getLogger(__name__)


def generate_maintenance_pdf(report_data: dict[str, Any]) -> io.BytesIO:
    """
    Generate a beautifully structured PDF maintenance report.
    Incorporates executive summaries, diagnosis, evidence trail, plant impact,
    procurement, and recommended action steps.
    """
    buffer = io.BytesIO()

    try:
        from reportlab.lib.pagesizes import letter
        from reportlab.lib import colors
        from reportlab.lib.units import inch
        from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT

        # Set up document
        doc = SimpleDocTemplate(
            buffer,
            pagesize=letter,
            rightMargin=0.5 * inch,
            leftMargin=0.5 * inch,
            topMargin=0.75 * inch,
            bottomMargin=0.75 * inch
        )

        styles = getSampleStyleSheet()
        
        # Define modern, harmonized colors matching OREON palette
        c_primary = colors.HexColor("#0f172a")    # Slate 900
        c_secondary = colors.HexColor("#4f46e5")  # Indigo 600
        c_accent = colors.HexColor("#06b6d4")     # Cyan 500
        c_text = colors.HexColor("#334155")       # Slate 700
        c_muted = colors.HexColor("#64748b")      # Slate 500
        c_bg_light = colors.HexColor("#f8fafc")   # Slate 50
        c_border = colors.HexColor("#e2e8f0")     # Slate 200
        c_crit = colors.HexColor("#ef4444")       # Red 500
        c_warn = colors.HexColor("#f59e0b")       # Amber 500
        c_ok = colors.HexColor("#10b981")         # Emerald 500

        # Custom paragraph styles
        styles.add(ParagraphStyle(
            name='ReportTitle',
            parent=styles['Normal'],
            fontName='Helvetica-Bold',
            fontSize=22,
            textColor=c_primary,
            leading=26,
            spaceAfter=6
        ))

        styles.add(ParagraphStyle(
            name='ReportSubtitle',
            parent=styles['Normal'],
            fontName='Helvetica',
            fontSize=11,
            textColor=c_muted,
            leading=14,
            spaceAfter=20
        ))

        styles.add(ParagraphStyle(
            name='SectionHeading',
            parent=styles['Normal'],
            fontName='Helvetica-Bold',
            fontSize=14,
            textColor=c_secondary,
            leading=18,
            spaceBefore=14,
            spaceAfter=8,
            keepWithNext=True
        ))

        styles.add(ParagraphStyle(
            name='BodyDark',
            parent=styles['Normal'],
            fontName='Helvetica',
            fontSize=10,
            textColor=c_text,
            leading=14,
            spaceAfter=6
        ))

        styles.add(ParagraphStyle(
            name='BodyMuted',
            parent=styles['Normal'],
            fontName='Helvetica-Oblique',
            fontSize=9,
            textColor=c_muted,
            leading=12,
            spaceAfter=4
        ))

        styles.add(ParagraphStyle(
            name='EvidenceText',
            parent=styles['Normal'],
            fontName='Courier',
            fontSize=9,
            textColor=colors.HexColor("#0f172a"),
            leading=12,
            spaceAfter=4
        ))

        styles.add(ParagraphStyle(
            name='CalloutText',
            parent=styles['Normal'],
            fontName='Helvetica',
            fontSize=11,
            textColor=c_secondary,
            leading=15
        ))

        story = []

        # Header Block
        story.append(Paragraph("OREON DECISION PACKET", styles['ReportTitle']))
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        story.append(Paragraph(f"Industrial Maintenance Decision Intelligence Platform · Generated {timestamp} IST", styles['ReportSubtitle']))

        # Asset Detail Metadata Table
        asset_info = report_data.get("asset", {})
        status_str = str(report_data.get("risk_level", asset_info.get("status", "unknown"))).upper()
        # NOTE: this must be a hex *string* — reportlab's paragraph parser cannot read a
        # Color object interpolated into a <font color='...'> tag, which would throw and
        # drop the whole report to the plain-text fallback.
        status_hex = (
            "#10b981" if ("OPERATIONAL" in status_str or "LOW" in status_str)
            else "#f59e0b" if ("DEGRADED" in status_str or "MEDIUM" in status_str)
            else "#ef4444"
        )

        meta_data = [
            [
                Paragraph("<b>Asset ID:</b>", styles['BodyDark']),
                Paragraph(str(report_data.get("asset_id", "—")), styles['BodyDark']),
                Paragraph("<b>Equipment Type:</b>", styles['BodyDark']),
                Paragraph(str(asset_info.get("equipment_type", "—")), styles['BodyDark']),
            ],
            [
                Paragraph("<b>Location:</b>", styles['BodyDark']),
                Paragraph(str(asset_info.get("location", "—")), styles['BodyDark']),
                Paragraph("<b>Production Line:</b>", styles['BodyDark']),
                Paragraph(str(asset_info.get("production_line", "—")), styles['BodyDark']),
            ],
            [
                Paragraph("<b>Health Score:</b>", styles['BodyDark']),
                Paragraph(f"{asset_info.get('health_score', 100):.1f}%", styles['BodyDark']),
                Paragraph("<b>RUL Estimate:</b>", styles['BodyDark']),
                Paragraph(f"{report_data.get('rul_days', asset_info.get('rul_days', 365))} Days", styles['BodyDark']),
            ],
            [
                Paragraph("<b>Status:</b>", styles['BodyDark']),
                Paragraph(f"<font color='{status_hex}'><b>{status_str}</b></font>", styles['BodyDark']),
                Paragraph("<b>Criticality:</b>", styles['BodyDark']),
                Paragraph(str(asset_info.get("criticality", "medium")).upper(), styles['BodyDark']),
            ]
        ]

        t_meta = Table(meta_data, colWidths=[1.2*inch, 2.3*inch, 1.4*inch, 2.6*inch])
        t_meta.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, -1), c_bg_light),
            ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('INNERGRID', (0, 0), (-1, -1), 0.5, c_border),
            ('BOX', (0, 0), (-1, -1), 1, c_muted),
            ('TOPPADDING', (0, 0), (-1, -1), 6),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ]))
        story.append(t_meta)
        story.append(Spacer(1, 15))

        # Executive Summary Callout Box
        story.append(Paragraph("Executive Summary", styles['SectionHeading']))
        summary_text = report_data.get("executive_summary", "No summary available.")
        
        t_summary = Table([[Paragraph(f"<i>{summary_text}</i>", styles['CalloutText'])]], colWidths=[7.5*inch])
        t_summary.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor("#eef2ff")), # Indigo 50
            ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('LINELEFT', (0, 0), (0, 0), 4, c_secondary),
            ('TOPPADDING', (0, 0), (-1, -1), 10),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 10),
            ('LEFTPADDING', (0, 0), (-1, -1), 12),
            ('RIGHTPADDING', (0, 0), (-1, -1), 12),
        ]))
        story.append(t_summary)
        story.append(Spacer(1, 15))

        # Diagnosis and Root Cause Analysis
        story.append(Paragraph("Diagnosis & Root Cause Analysis", styles['SectionHeading']))
        story.append(Paragraph(f"<b>Diagnosis:</b> {report_data.get('diagnosis', 'Undetermined')}", styles['BodyDark']))
        story.append(Paragraph(f"<b>Root Cause:</b> {report_data.get('root_cause', 'Unknown')}", styles['BodyDark']))
        story.append(Paragraph(f"<b>Confidence Score:</b> {report_data.get('confidence', 0.0)*100:.1f}%", styles['BodyDark']))
        story.append(Spacer(1, 15))

        # Evidence Trail
        story.append(Paragraph("Evidence Trail", styles['SectionHeading']))
        evidence_bundle = report_data.get("evidence", {})
        
        # Sensor Evidence
        sensor_ev = evidence_bundle.get("sensor_evidence", [])
        if sensor_ev:
            story.append(Paragraph("Sensor Telemetry & Threshold Violations:", styles['BodyDark']))
            for se in sensor_ev[:5]:
                story.append(Paragraph(f"• {se}", styles['EvidenceText']))
            story.append(Spacer(1, 5))

        # Manual & SOP Evidence
        manual_ev = evidence_bundle.get("manual_evidence", [])
        sop_ev = evidence_bundle.get("sop_evidence", [])
        procedural = manual_ev + sop_ev
        if procedural:
            story.append(Paragraph("Retrieved Standard Operating Procedures (SOPs) & Manuals:", styles['BodyDark']))
            for chunk in procedural[:3]:
                src_doc = getattr(chunk, "source_document", chunk.get("source_document", "Procedure"))
                txt = getattr(chunk, "text", chunk.get("text", ""))
                story.append(Paragraph(f"• <b>[{src_doc}]:</b> {txt[:200]}...", styles['BodyDark']))
            story.append(Spacer(1, 5))

        # Historical Incidents
        hist_ev = evidence_bundle.get("historical_evidence", report_data.get("similar_incidents", []))
        if hist_ev:
            story.append(Paragraph("Corroborating Historical Incidents:", styles['BodyDark']))
            h_data = [["Incident ID", "Asset", "Root Cause", "Action", "Downtime"]]
            for inc in hist_ev[:4]:
                h_data.append([
                    str(inc.get("incident_id", "—")),
                    str(inc.get("asset_id", "—")),
                    str(inc.get("root_cause", "—")[:20]),
                    str(inc.get("corrective_action", "—")[:25]) + "...",
                    f"{inc.get('downtime_hours', 0):.1f}h"
                ])
            t_hist = Table(h_data, colWidths=[1.1*inch, 1.1*inch, 1.8*inch, 2.5*inch, 1.0*inch])
            t_hist.setStyle(TableStyle([
                ('BACKGROUND', (0, 0), (-1, 0), c_primary),
                ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
                ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
                ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
                ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, c_bg_light]),
                ('INNERGRID', (0, 0), (-1, -1), 0.5, c_border),
                ('BOX', (0, 0), (-1, -1), 0.5, c_muted),
                ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
                ('FONTSIZE', (0, 0), (-1, 0), 9),
                ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
                ('FONTSIZE', (0, 1), (-1, -1), 9),
                ('TOPPADDING', (0, 0), (-1, -1), 4),
                ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
            ]))
            story.append(t_hist)
            story.append(Spacer(1, 15))

        # Page Break for Plan & Spares
        story.append(PageBreak())

        # Recommended Action Plan
        story.append(Paragraph("Recommended Action Plan", styles['SectionHeading']))
        actions = report_data.get("recommended_actions", [])
        if actions:
            for act in actions:
                story.append(Paragraph(f"• {act}", styles['BodyDark']))
        else:
            story.append(Paragraph("Inspect asset and check terminal boxes.", styles['BodyDark']))
        story.append(Spacer(1, 15))

        # Maintenance Schedule (if available)
        schedule = report_data.get("maintenance_plan", {}).get("maintenance_schedule", [])
        if schedule:
            story.append(Paragraph("Maintenance Activity Schedule:", styles['BodyDark']))
            s_data = [["Task Description", "Estimated Hours", "Skill Level Required"]]
            for task in schedule:
                s_data.append([
                    str(task.get("task", "Maintenance Intervention")),
                    f"{task.get('duration_hours', 1.0):.1f} h",
                    str(task.get("skill_level", "Technician"))
                ])
            t_sched = Table(s_data, colWidths=[4.2*inch, 1.5*inch, 1.8*inch])
            t_sched.setStyle(TableStyle([
                ('BACKGROUND', (0, 0), (-1, 0), c_secondary),
                ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
                ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
                ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, c_bg_light]),
                ('INNERGRID', (0, 0), (-1, -1), 0.5, c_border),
                ('BOX', (0, 0), (-1, -1), 0.5, c_muted),
                ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
                ('FONTSIZE', (0, 0), (-1, 0), 9),
                ('TOPPADDING', (0, 0), (-1, -1), 4),
                ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
            ]))
            story.append(t_sched)
            story.append(Spacer(1, 15))

        # Procurement & Spare Parts Status
        story.append(Paragraph("Spare Parts & Procurement Status", styles['SectionHeading']))
        procurement = report_data.get("procurement", {})
        avail = procurement.get("available_parts", [])
        missing = procurement.get("missing_parts", [])
        
        p_data = [["Part Name", "Stock Status", "Location / Lead Time"]]
        for part in avail:
            p_name = part.get("part_name", part.get("name", "Spare Part"))
            p_data.append([
                p_name,
                "IN STOCK",
                part.get("storage_location", "Warehouse A")
            ])
        for part in missing:
            p_name = part.get("part_name", part.get("name", "Spare Part"))
            p_data.append([
                p_name,
                f"SHORTAGE (Lead time: {part.get('lead_time_days', 5)}d)",
                f"Supplier: {part.get('supplier', 'Standard vendor')}"
            ])
            
        if len(p_data) > 1:
            t_proc = Table(p_data, colWidths=[3.2*inch, 1.8*inch, 2.5*inch])
            t_proc.setStyle(TableStyle([
                ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor("#3b82f6")), # Blue 500
                ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
                ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
                ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, c_bg_light]),
                ('INNERGRID', (0, 0), (-1, -1), 0.5, c_border),
                ('BOX', (0, 0), (-1, -1), 0.5, c_muted),
                ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
                ('TOPPADDING', (0, 0), (-1, -1), 4),
                ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
            ]))
            story.append(t_proc)
        else:
            story.append(Paragraph("No specific spares registered for this action.", styles['BodyDark']))

        # Build Document
        doc.build(story)

    except Exception as exc:
        logger.exception("Failed to compile PDF report: %s", exc)
        # Fallback text generator
        buffer.seek(0)
        buffer.truncate(0)
        buffer.write(f"OREON INDUSTRIAL MAINTENANCE REPORT\n{'='*35}\n\n".encode("utf-8"))
        buffer.write(f"Generated at: {datetime.now().isoformat()}\n".encode("utf-8"))
        buffer.write(f"Asset ID: {report_data.get('asset_id')}\n".encode("utf-8"))
        buffer.write(f"Diagnosis: {report_data.get('diagnosis')}\n".encode("utf-8"))
        buffer.write(f"Root Cause: {report_data.get('root_cause')}\n".encode("utf-8"))
        buffer.write(f"RUL Days: {report_data.get('rul_days')}\n".encode("utf-8"))
        buffer.write(f"\nExecutive Summary:\n{report_data.get('executive_summary')}\n".encode("utf-8"))
        buffer.write(f"\nRecommended Actions:\n".encode("utf-8"))
        for act in report_data.get("recommended_actions", []):
            buffer.write(f"- {act}\n".encode("utf-8"))

    buffer.seek(0)
    return buffer


def _fmt_inr(v: Any) -> str:
    """Format a number as Indian-currency text (ASCII 'Rs' — reportlab's core
    fonts don't carry the ₹ glyph)."""
    try:
        v = float(v or 0)
    except (TypeError, ValueError):
        v = 0.0
    a = abs(v)
    if a >= 1_00_00_000:
        return f"Rs {v / 1_00_00_000:.2f} Cr"
    if a >= 1_00_000:
        return f"Rs {v / 1_00_000:.1f} L"
    return f"Rs {v:,.0f}"


def generate_plant_report_pdf(kind: str, data: dict[str, Any]) -> io.BytesIO:
    """
    Build a whole-plant report PDF for the Decisions page tabs.

    kind == "maintenance" -> KPI summary, asset health status, queued actions.
    kind == "business"    -> financial KPIs and the asset business-risk matrix.
    """
    buffer = io.BytesIO()

    try:
        from reportlab.lib.pagesizes import letter
        from reportlab.lib import colors
        from reportlab.lib.units import inch
        from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle

        doc = SimpleDocTemplate(
            buffer, pagesize=letter,
            rightMargin=0.5 * inch, leftMargin=0.5 * inch,
            topMargin=0.75 * inch, bottomMargin=0.75 * inch,
        )
        styles = getSampleStyleSheet()
        c_primary = colors.HexColor("#0f172a")
        c_secondary = colors.HexColor("#4f46e5")
        c_muted = colors.HexColor("#64748b")
        c_text = colors.HexColor("#334155")
        c_bg_light = colors.HexColor("#f8fafc")
        c_border = colors.HexColor("#e2e8f0")

        styles.add(ParagraphStyle(name='PTitle', parent=styles['Normal'], fontName='Helvetica-Bold', fontSize=22, textColor=c_primary, leading=26, spaceAfter=4))
        styles.add(ParagraphStyle(name='PSub', parent=styles['Normal'], fontName='Helvetica', fontSize=11, textColor=c_muted, leading=14, spaceAfter=18))
        styles.add(ParagraphStyle(name='PHead', parent=styles['Normal'], fontName='Helvetica-Bold', fontSize=14, textColor=c_secondary, leading=18, spaceBefore=14, spaceAfter=8))
        styles.add(ParagraphStyle(name='PBody', parent=styles['Normal'], fontName='Helvetica', fontSize=10, textColor=c_text, leading=14, spaceAfter=6))

        def table_style(header_bg) -> "TableStyle":
            return TableStyle([
                ('BACKGROUND', (0, 0), (-1, 0), header_bg),
                ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
                ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
                ('FONTSIZE', (0, 0), (-1, -1), 8.5),
                ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
                ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, c_bg_light]),
                ('INNERGRID', (0, 0), (-1, -1), 0.5, c_border),
                ('BOX', (0, 0), (-1, -1), 0.5, c_muted),
                ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
                ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
                ('TOPPADDING', (0, 0), (-1, -1), 4),
                ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
            ])

        def kpi_style() -> "TableStyle":
            return TableStyle([
                ('BACKGROUND', (0, 0), (-1, -1), c_bg_light),
                ('BOX', (0, 0), (-1, -1), 0.5, c_muted),
                ('INNERGRID', (0, 0), (-1, -1), 0.5, c_border),
                ('TOPPADDING', (0, 0), (-1, -1), 6),
                ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
            ])

        story = []
        ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        if kind == "maintenance":
            priority = data.get("priority", [])
            actions = data.get("actions", [])
            healths = [(p.get("health_score") or 0) for p in priority]
            avg_health = round(sum(healths) / len(healths)) if healths else 0
            crit = sum(1 for h in healths if h < 50)
            warn = sum(1 for h in healths if 50 <= h < 75)
            healthy = sum(1 for h in healths if h >= 75)

            story.append(Paragraph("OREON PLANT MAINTENANCE REPORT", styles['PTitle']))
            story.append(Paragraph(f"Industrial Maintenance Decision Intelligence Platform &middot; Generated {ts} IST", styles['PSub']))

            kpi = [[
                Paragraph("<b>Avg Plant Health</b>", styles['PBody']), Paragraph(f"{avg_health}%", styles['PBody']),
                Paragraph("<b>Critical</b>", styles['PBody']), Paragraph(str(crit), styles['PBody']),
                Paragraph("<b>Warning</b>", styles['PBody']), Paragraph(str(warn), styles['PBody']),
                Paragraph("<b>Healthy</b>", styles['PBody']), Paragraph(str(healthy), styles['PBody']),
            ]]
            t_kpi = Table(kpi, colWidths=[1.4 * inch, 0.7 * inch, 0.8 * inch, 0.55 * inch, 0.85 * inch, 0.55 * inch, 0.85 * inch, 0.55 * inch])
            t_kpi.setStyle(kpi_style())
            story.append(t_kpi)
            story.append(Spacer(1, 14))

            story.append(Paragraph("Asset Health Status", styles['PHead']))
            rows = [["Asset ID", "Name", "Health", "Fail %", "RUL", "Priority Band"]]
            for p in priority[:20]:
                pr = p.get("priority", {}) or {}
                rows.append([
                    str(p.get("asset_id", "-")),
                    str(p.get("asset_name", "-"))[:24],
                    f"{round(p.get('health_score') or 0)}%",
                    f"{round((p.get('failure_probability') or 0) * 100)}%",
                    f"{p.get('rul_days', '-')}d",
                    str(pr.get("priority_band", "-")),
                ])
            t = Table(rows, colWidths=[1.3 * inch, 2.1 * inch, 0.8 * inch, 0.8 * inch, 0.8 * inch, 1.3 * inch])
            t.setStyle(table_style(c_primary))
            story.append(t)
            story.append(Spacer(1, 14))

            story.append(Paragraph("Queued Maintenance Actions", styles['PHead']))
            arows = [["Band", "Asset", "Recommended Action", "Due Window"]]
            for a in actions[:20]:
                arows.append([
                    str(a.get("priority_band", "-")),
                    str(a.get("asset_name", "-"))[:22],
                    str(a.get("action", "-"))[:42],
                    str(a.get("due_window", "-")),
                ])
            if len(arows) > 1:
                ta = Table(arows, colWidths=[1.0 * inch, 1.8 * inch, 3.3 * inch, 1.4 * inch])
                ta.setStyle(table_style(c_secondary))
                story.append(ta)
            else:
                story.append(Paragraph("No critical or high-priority actions queued.", styles['PBody']))

        else:  # business
            risks = data.get("risks", [])
            total_exposure = sum((r.get("revenue_exposure_inr") or 0) for r in risks)
            total_inaction = sum((r.get("cost_of_inaction_inr") or 0) for r in risks)
            total_action = sum((r.get("cost_of_action_inr") or 0) for r in risks)
            total_downtime = sum((r.get("estimated_downtime_hours") or 0) for r in risks)

            story.append(Paragraph("OREON BUSINESS IMPACT REPORT", styles['PTitle']))
            story.append(Paragraph(f"Financial exposure from asset degradation &middot; Generated {ts} IST", styles['PSub']))

            kpi = [
                [
                    Paragraph("<b>Revenue Exposure</b>", styles['PBody']), Paragraph(_fmt_inr(total_exposure), styles['PBody']),
                    Paragraph("<b>Cost of Inaction</b>", styles['PBody']), Paragraph(_fmt_inr(total_inaction), styles['PBody']),
                ],
                [
                    Paragraph("<b>Repair Investment</b>", styles['PBody']), Paragraph(_fmt_inr(total_action), styles['PBody']),
                    Paragraph("<b>Net Savings</b>", styles['PBody']), Paragraph(_fmt_inr(total_inaction - total_action), styles['PBody']),
                ],
                [
                    Paragraph("<b>Est. Downtime</b>", styles['PBody']), Paragraph(f"{round(total_downtime)} h", styles['PBody']),
                    Paragraph("<b>Assets Assessed</b>", styles['PBody']), Paragraph(str(len(risks)), styles['PBody']),
                ],
            ]
            t_kpi = Table(kpi, colWidths=[1.6 * inch, 1.6 * inch, 1.6 * inch, 1.6 * inch])
            t_kpi.setStyle(kpi_style())
            story.append(t_kpi)
            story.append(Spacer(1, 14))

            story.append(Paragraph("Asset Business Risk Matrix", styles['PHead']))
            rows = [["Asset", "Production Line", "Revenue Exp.", "Downtime", "Risk", "Action Cost"]]
            for r in risks[:20]:
                rows.append([
                    str(r.get("asset_name", "-"))[:20],
                    str(r.get("production_line") or "-")[:14],
                    _fmt_inr(r.get("revenue_exposure_inr") or 0),
                    f"{r.get('estimated_downtime_hours', 0) or 0}h",
                    str(r.get("business_risk", "-")),
                    _fmt_inr(r.get("cost_of_action_inr") or 0),
                ])
            t = Table(rows, colWidths=[1.5 * inch, 1.1 * inch, 1.4 * inch, 0.9 * inch, 0.9 * inch, 1.3 * inch])
            t.setStyle(table_style(c_primary))
            story.append(t)
            story.append(Spacer(1, 14))
            story.append(Paragraph(
                f"<b>Business case:</b> Proactive maintenance across the assessed assets avoids "
                f"{_fmt_inr(total_inaction)} in cost-of-inaction for an investment of {_fmt_inr(total_action)} "
                f"&mdash; a net benefit of {_fmt_inr(total_inaction - total_action)}.",
                styles['PBody'],
            ))

        doc.build(story)

    except Exception as exc:
        logger.exception("Failed to compile plant report PDF: %s", exc)
        buffer.seek(0)
        buffer.truncate(0)
        buffer.write(f"OREON {kind.upper()} REPORT\n{'=' * 35}\n".encode("utf-8"))
        buffer.write(f"Generated at: {datetime.now().isoformat()}\n".encode("utf-8"))

    buffer.seek(0)
    return buffer
