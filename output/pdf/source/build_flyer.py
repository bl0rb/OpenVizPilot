from pathlib import Path
from html import escape
from decimal import Decimal, ROUND_HALF_UP
from reportlab.pdfgen import canvas
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import Paragraph
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 'output/pdf'
OUT.mkdir(parents=True, exist_ok=True)
FONTS = Path('/System/Library/Fonts/Supplemental')
pdfmetrics.registerFont(TTFont('Arial', str(FONTS / 'Arial.ttf')))
pdfmetrics.registerFont(TTFont('Arial-Bold', str(FONTS / 'Arial Bold.ttf')))
pdfmetrics.registerFontFamily('Arial', normal='Arial', bold='Arial-Bold')

W, H = A4
INK = '#18212F'
BLUE = '#2563EB'
DEEP = '#1E40AF'
MUTED = '#526071'
LIGHT = '#EFF5FF'
RULE = '#D8E1EE'
WHITE = '#FFFFFF'
GREEN = '#147363'
M = 44
CW = W - M * 2
pdf = OUT / 'OpenVizPilot-Verkaufsflyer.pdf'
c = canvas.Canvas(str(pdf), pagesize=A4, pageCompression=1)
c.setTitle('OpenVizPilot | KI für Tableau | Editionsvergleich und Jahreslizenz')
c.setAuthor('WerkWorks')
c.setSubject('Dashboard-Chat, Tableau-API mit KI und Benutzerfreigaben. Entwicklungsstand 15.09.2026.')


def box(x, y, w, h, fill, stroke=None, radius=0):
    c.setFillColor(colors.HexColor(fill))
    c.setStrokeColor(colors.HexColor(stroke or fill))
    c.setLineWidth(0.6)
    if radius:
        c.roundRect(x, H-y-h, w, h, radius, fill=1, stroke=bool(stroke))
    else:
        c.rect(x, H-y-h, w, h, fill=1, stroke=bool(stroke))


def text(s, x, y, size=10, color=INK, bold=False):
    c.setFillColor(colors.HexColor(color))
    c.setFont('Arial-Bold' if bold else 'Arial', size)
    c.drawString(x, H-y-size, s)


def para(s, x, y, width, size=10, color=INK, leading=None, bold=False):
    style = ParagraphStyle('flyer', fontName='Arial-Bold' if bold else 'Arial',
                           fontSize=size, leading=leading or size*1.38,
                           textColor=colors.HexColor(color), spaceAfter=0)
    p = Paragraph(s, style)
    _, h = p.wrap(width, 900)
    assert y+h < H-20, (s, y, h)
    p.drawOn(c, x, H-y-h)
    return h


def line(x1, y1, x2, y2, color=RULE, width=0.7):
    c.setStrokeColor(colors.HexColor(color))
    c.setLineWidth(width)
    c.line(x1, H-y1, x2, H-y2)


def logo(y=28):
    c.drawImage(str(OUT / 'source/OpenVizPilot-logo.png'), M, H-y-30,
                width=30, height=30, mask='auto')
    text('OpenVizPilot', M+40, y-1, 23, bold=True)
    text('KI FÜR TABLEAU', M+41, y+27, 8, BLUE, bold=True)
    text('WerkWorks', W-M-65, y+7, 10, MUTED, True)


def footer(page):
    line(M, 804, W-M, 804)
    text('WerkWorks  ·  info@werkworks.de', M, 813, 8, MUTED)
    text(f'Entwicklungsstand 15.09.2026  ·  {page}/4', W-M-168, 813, 8, MUTED)
    c.linkURL('mailto:info@werkworks.de', (M, H-827, M+184, H-810), relative=0)


logo()
text('Aus Dashboard-Daten', M, 94, 30, bold=True)
text('werden Antworten.', M, 131, 30, BLUE, True)
para('Fragen stellen. Zusammenhänge verstehen. Fundierter entscheiden.', M, 181, CW, 12.1, bold=True)
para('OpenVizPilot bringt den KI-Dialog direkt in Ihr Tableau-Dashboard. '
     'Fachbereiche analysieren sichtbare Daten in natürlicher Sprache. '
     'Enterprise ergänzt die Suche nach Server-Inhalten, Felddefinitionen und Formeln.',
     M, 208, CW, 10.6, MUTED, 15)

image_y = 268
image_h = CW * 1712 / 2986
c.drawImage(str(ROOT / 'docs/images/beispiel-dashboard.png'), M, H-image_y-image_h,
            width=CW, height=image_h, mask='auto')
line(M, image_y+image_h+6, W-M, image_y+image_h+6)
text('Produktansicht: Zusammenfassung eines Tableau-Dashboards mit Quellenbezug.',
     M, image_y+image_h+13, 8.1, MUTED)

benefits = [
    ('01', 'Fragen statt suchen', 'Kennzahlen vergleichen, Auffälligkeiten erkennen und Filterkontext verstehen.'),
    ('02', 'Definitionen verstehen', 'Enterprise findet Felder und erklärt bereitgestellte Formeln und Abhängigkeiten.'),
    ('03', 'Kontrolliert einsetzen', 'Admins geben KI und API separat frei. Quellen und Tool-Aufrufe bleiben nachvollziehbar.'),
]
gap = 19
bw = (CW-gap*2)/3
for i, (number, title, body) in enumerate(benefits):
    x = M+i*(bw+gap)
    text(number, x, 602, 8.5, BLUE, True)
    text(title, x, 620, 10.2, bold=True)
    para(body, x, 640, bw, 9.1, MUTED, 12.4)

box(M, 704, CW, 86, DEEP)
text('ENTERPRISE-JAHRESLIZENZ', M+17, 716, 8.5, WHITE, True)
text('14.500 €', M+17, 735, 31, WHITE, True)
text('netto', M+164, 752, 10, WHITE)
para('Für ein Jahr pro Tableau-Cluster.<br/>KI-Modell- und Infrastrukturkosten trägt der Kunde.',
     M+245, 724, CW-262, 9.3, WHITE, 13)
text('Demo anfragen: info@werkworks.de', M+245, 766, 9, WHITE, True)
c.linkURL('mailto:info@werkworks.de?subject=OpenVizPilot%20Demo',
          (M+245, H-782, W-M-10, H-762), relative=0)
footer(1)
c.showPage()

logo()
text('Die passende Edition.', M, 92, 25, bold=True)
text('Dashboard-KI im Core. Zusätzlicher Kontext und Kontrolle mit Enterprise.', M, 126, 9.7, MUTED)

table_y = 154
feature_w = 315
core_w = 91
ee_w = CW-feature_w-core_w
box(M, table_y, CW, 31, INK)
text('Funktionsumfang', M+10, table_y+8, 10, WHITE, True)
text('Open Core', M+feature_w+10, table_y+8, 9.8, WHITE, True)
text('Enterprise', M+feature_w+core_w+8, table_y+8, 9.8, WHITE, True)
rows = [
    ('KI-Chat mit Dashboarddaten, Filtern und Parametern', True, True),
    ('Quellen, sichtbarer Tool-Verlauf und Markdown-Export', True, True),
    ('Modellkatalog, Glossar und zentrale Analysevorlagen', True, True),
    ('Lokale Konten und zentrale Benutzerfreigaben', True, True),
    ('Single Sign-On: Entra ID, Keycloak und OIDC', False, True),
    ('Persönliches Memory, Antwortfokus und eigene Fragen', False, True),
    ('Dashboard-Aktionen nach Bestätigung per Klick', False, True),
    ('Freigegebene MCP-Quellen und Websuche', False, True),
    ('Tableau-Server-Suche nach Workbooks und Views', False, True),
    ('Metadata API: Felder, Definitionen und Formeln', False, True),
    ('Begrenzte Lineage-, Dictionary- und Impact-Grundlage', False, True),
]
rh = 21.5


def check(cx, cy, yes):
    if yes:
        line(cx-4, cy, cx-1, cy+3, GREEN, 1.4)
        line(cx-1, cy+3, cx+5, cy-4, GREEN, 1.4)
    else:
        line(cx-3, cy, cx+3, cy, MUTED, 1)


for i, (label, core, ee) in enumerate(rows):
    y = table_y+31+i*rh
    if i % 2 == 0:
        box(M, y, CW, rh, '#F5F7FA')
    box(M+feature_w+core_w, y, ee_w, rh, LIGHT)
    text(label, M+10, y+5.6, 8.7)
    check(M+feature_w+core_w/2, y+rh/2, core)
    check(M+feature_w+core_w+ee_w/2, y+rh/2, ee)
    line(M, y+rh, W-M, y+rh, RULE, .3)

text('Haken = enthalten. Enterprise-Funktionen benötigen die passende Lizenz und Konfiguration.',
     M, 428, 7.7, MUTED)
text('Ein Chat. Zwei Fragen. Zwei Wege.', M, 451, 19, bold=True)
text('Fragen und Antworten bleiben im selben OpenVizPilot-Chatfenster im Dashboard.',
     M, 479, 9, MUTED)

# One scene description is used for the PDF and the reusable accessible SVG.
scene = []


def srect(x, y, w, h, fill, stroke):
    scene.append(('rect', x, y, w, h, fill, stroke))


def st(s, x, y, size, color, bold=False):
    scene.append(('text', s, x, y, size, color, bold))


def sp(points, arrow=False):
    scene.append(('path', points, arrow))


# A single chat branches into two questions and data paths; one return route
# makes it explicit that Enterprise does not open a second chat window.
st('CHAT', 0, 3, 17, BLUE, True)
st('BEISPIELFRAGEN', 245, 3, 17, BLUE, True)
st('DATENWEGE', 540, 3, 17, BLUE, True)
st('KI-VERARBEITUNG', 850, 3, 17, BLUE, True)

srect(0, 110, 190, 115, LIGHT, BLUE)
st('OpenVizPilot', 14, 128, 20, INK, True)
st('Chat im Dashboard', 14, 159, 17, INK)
st('Ein Fenster für beides', 14, 192, 15, MUTED)

for y, question, title, sub, edition, permission in [
    (35, ('„Was fällt im', 'Dashboard auf?“'), 'Dashboarddaten',
     'Extensions API · Nutzersitzung', 'CORE + ENTERPRISE', 'KI-Freigabe'),
    (200, ('„Wie ist die', 'Marge definiert?“'), 'Tableau Server APIs',
     'REST + Metadata · OIDC-Nutzer', 'ENTERPRISE', 'KI- und API-Freigabe + Tableau-Rechte'),
]:
    srect(245, y, 255, 80, WHITE, RULE)
    st(question[0], 259, y+14, 20, INK, True)
    st(question[1], 259, y+42, 20, INK, True)
    srect(540, y, 270, 80, WHITE, RULE)
    st(title, 554, y+14, 20, INK, True)
    st(sub, 554, y+46, 15, MUTED)
    st(edition, 540, y+89, 15, BLUE, True)
    st(permission, 245, y+89, 14, MUTED)
    sp([(500, y+40), (540, y+40)], True)
    sp([(810, y+40), (850, y+40)], True)

srect(850, 35, 250, 245, LIGHT, BLUE)
st('OpenVizPilot + KI', 867, 130, 20, INK, True)
st('Konfiguriertes Modell', 867, 164, 17, MUTED)
st('analysiert und erklärt', 867, 190, 17, MUTED)

sp([(190, 165), (220, 165)])
sp([(220, 75), (220, 240)])
sp([(220, 75), (245, 75)], True)
sp([(220, 240), (245, 240)], True)
sp([(975, 280), (975, 334), (95, 334), (95, 225)], True)
st('Antwort mit Quellen zurück in dasselbe Chatfenster', 283, 310, 17, INK, True)

scale = CW / 1100
gy = 505
svg = []
for item in scene:
    if item[0] == 'rect':
        _, x, y, width, height, fill, stroke = item
        box(M+x*scale, gy+y*scale, width*scale, height*scale, fill, stroke, 2)
        svg.append(f'<rect x="{x}" y="{y}" width="{width}" height="{height}" rx="4" fill="{fill}" stroke="{stroke}"/>')
    elif item[0] == 'text':
        _, value, x, y, size, color, bold = item
        text(value, M+x*scale, gy+y*scale, size*scale, color, bold)
        svg.append(f'<text x="{x}" y="{y+size}" font-size="{size}" font-weight="{700 if bold else 400}" fill="{color}">{escape(value)}</text>')
    else:
        _, points, arrow = item
        for (x1, y1), (x2, y2) in zip(points, points[1:]):
            line(M+x1*scale, gy+y1*scale, M+x2*scale, gy+y2*scale, MUTED, .8)
        if arrow:
            x1, y1 = points[-2]
            x2, y2 = points[-1]
            length = ((x2-x1)**2+(y2-y1)**2)**.5
            dx, dy = (x2-x1)/length, (y2-y1)/length
            p = c.beginPath()
            p.moveTo(M+x2*scale, H-gy-y2*scale)
            for side in [-1, 1]:
                p.lineTo(M+(x2-7*dx+side*4*dy)*scale,
                         H-gy-(y2-7*dy-side*4*dx)*scale)
            p.close()
            c.setFillColor(colors.HexColor(MUTED))
            c.drawPath(p, fill=1, stroke=0)
        path = 'M'+'L'.join(f'{x} {y}' for x, y in points)
        marker = ' marker-end="url(#ovp-flow-arrow)"' if arrow else ''
        svg.append(f'<path d="{path}" fill="none" stroke="{MUTED}" stroke-width="2"{marker}/>')

text('Vereinfachter Ablauf: Die KI veranlasst gezielte Tool-Abfragen und erhält deren Ergebnisse.',
     M, 668, 7.8, MUTED)
para('<b>Kontrolle bleibt bei Ihnen.</b> Der Dashboardzugriff erfolgt in der Tableau-Sitzung des Nutzers; '
     'Server-Metadaten werden unter seiner verifizierten OIDC-Identität gelesen. '
     'Der erforderliche Datenkontext wird an den konfigurierten KI-Anbieter übermittelt.',
     M, 690, CW, 8.8, MUTED, 12)
para('<b>Lizenz &amp; Voraussetzungen.</b> Open Core ist source-available unter PolyForm Noncommercial, '
     'nicht frei für kommerzielle Nutzung; dafür ist eine Vereinbarung erforderlich. '
     'Enterprise: 14.500 € netto für ein Jahr pro Tableau-Cluster. KI-Modell- und Infrastrukturkosten trägt der Kunde. '
     'Server-API: Zielversion Tableau Server ab 2025.3, Connected App, OIDC und aktivierte Metadata API. '
     'Externe Asset-Sichtbarkeit hängt von Tableau-Lizenzen und Rechten ab. '
     'Kein vollständiger Lineage-Explorer; keine pauschale Kompatibilitätszusage ohne Prüfung der Zielumgebung.',
     M, 737, CW, 7.6, MUTED, 10.3)
footer(2)
c.showPage()

logo()
text('Zentral steuern. Gezielt freigeben.', M, 92, 24, bold=True)
para('Die Admin-Oberfläche bündelt Benutzerzugriff, KI-Modelle und Datenquellen. '
     'So legen Sie fest, wer OpenVizPilot nutzt und welcher Funktionsumfang verfügbar ist.',
     M, 129, CW, 10.5, MUTED, 14.5)

admin_items = [
    ('01', 'Benutzer und Freigaben', 'CORE + ENTERPRISE',
     'Lokale Konten anlegen, Passwörter zurücksetzen und Benutzer sperren. '
     'KI- und API-Zugriff separat vergeben; neue lokale und SSO-Identitäten starten ohne Freigabe.'),
    ('02', 'SSO und Enterprise-Lizenz', 'ENTERPRISE',
     'Entra ID, Keycloak oder einen OIDC-Anbieter konfigurieren. '
     'Lizenzschlüssel hinterlegen und den Lizenzstatus prüfen. '
     'Eine Benutzeranmeldung vergibt keine Admin-Rechte.'),
    ('03', 'KI-Modelle vorgeben', 'CORE + ENTERPRISE',
     'Modelle vom konfigurierten KI-Endpunkt laden, verständliche Anzeigenamen vergeben '
     'und den angebotenen Modellkatalog festlegen. Die Auswahl wird auch serverseitig geprüft.'),
    ('04', 'Standardanalysen pflegen', 'CORE + ENTERPRISE',
     'Globale Slash-Befehle und Analysevorlagen zentral verwalten. '
     'Pro Dashboard bis zu fünf Starterfragen und eigene Befehle hinterlegen: '
     'wiederverwendbare Analysen für den Fachbereich.'),
    ('05', 'Tableau Server anbinden', 'ENTERPRISE',
     'Server, Site, Connected App und Nutzerzuordnung konfigurieren. '
     'Die Verbindung mit persönlicher SSO-Anmeldung prüfen. '
     'Content-Suche und Metadata API bleiben an Lizenzen und Tableau-Rechte gebunden.'),
    ('06', 'MCP-Quellen eingrenzen', 'ENTERPRISE',
     'Externe Quellen und Websuche über MCP verwalten. '
     'Sites, Dashboards und authentifizierte Mitglieder gezielt zuordnen. '
     'Externe Anfragen erfordern die vorgesehenen Freigaben und Bestätigungen.'),
    ('07', 'Extension bereitstellen', 'CORE + ENTERPRISE',
     'Die öffentliche HTTPS-Adresse hinterlegen und das passende Tableau-Manifest '
     '(.trex) herunterladen. Danach die Extension in Tableau freigeben und '
     'in die gewünschten Dashboards einbinden.'),
    ('08', 'Nutzung einordnen', 'CORE + ENTERPRISE',
     'Aggregierte Zähler für Modelle, Tools, Befehle und Fehler auswerten. '
     'Dashboard-Nutzung über Zeiträume betrachten; Nutzerzahlen werden pseudonymisiert '
     'ermittelt, Chat-Inhalte nicht als Nutzungsstatistik gespeichert.'),
]
col_gap = 25
col_w = (CW-col_gap)/2
for i, (number, title, edition, body) in enumerate(admin_items):
    x = M+(i%2)*(col_w+col_gap)
    y = 184+(i//2)*125
    line(x, y, x+col_w, y)
    text(number, x, y+12, 9, BLUE, True)
    text(title, x+25, y+10, 12.1, bold=True)
    text(edition, x+25, y+29, 7.5, BLUE, True)
    para(body, x, y+50, col_w, 9.7, MUTED, 13.1)

box(M, 703, CW, 80, LIGHT)
text('Vom Konto zur freigegebenen Nutzung.', M+16, 716, 14, bold=True)
para('<b>Anmelden</b> &nbsp; / &nbsp; <b>Identität prüfen</b> &nbsp; / &nbsp; '
     '<b>KI und API freigeben</b> &nbsp; / &nbsp; <b>Im Chat arbeiten</b>',
     M+16, 742, CW-32, 9.2, INK, 13)
text('Freigaben ersetzen keine Enterprise-Lizenz und keine Tableau-Berechtigungen.',
     M+16, 765, 8, MUTED)
footer(3)
c.showPage()

# Illustrative assumptions, not measured customer outcomes. USD/EUR is a
# planning assumption; total tokens include all model calls for one question.
employees, questions_per_day, workdays = 25, 2, 220
manual_minutes, assisted_minutes = Decimal('8'), Decimal('3')
hourly_cost = Decimal('60')
input_tokens, output_tokens = Decimal('20000'), Decimal('3000')
input_rate, output_rate = Decimal('0.75'), Decimal('4.50')
usd_to_eur = Decimal('0.90')
license_cost, infrastructure = Decimal('14500'), Decimal('2400')
input_usd = input_tokens/Decimal('1000000')*input_rate
output_usd = output_tokens/Decimal('1000000')*output_rate
api_per_question = (input_usd+output_usd)*usd_to_eur
annual_questions = Decimal(employees*questions_per_day*workdays)
saved_hours = annual_questions*(manual_minutes-assisted_minutes)/Decimal('60')
time_value = saved_hours*hourly_cost
annual_api = api_per_question*annual_questions
annual_costs = license_cost+infrastructure+annual_api
net_potential = time_value-annual_costs
break_even_minutes = annual_costs/annual_questions/hourly_cost*Decimal('60')
assert annual_questions == 11000 and annual_api == Decimal('282.15000')
assert net_potential == Decimal('37817.85000')


def de(value, places=2):
    rounded = Decimal(value).quantize(Decimal(10)**-places, rounding=ROUND_HALF_UP)
    return f'{rounded:,.{places}f}'.replace(',', '_').replace('.', ',').replace('_', '.')


logo()
text('Weniger Suchzeit. Mehr Freiraum.', M, 92, 24, bold=True)
text('Transparente Beispielrechnung für einen Tableau-Cluster. Keine Einspargarantie.',
     M, 126, 9.7, MUTED)

box(M, 151, CW, 62, LIGHT)
for i, (large, label) in enumerate([
    ('25 Mitarbeitende', '2 Fragen/Tag · 220 Arbeitstage'),
    ('8 statt 3 Minuten', 'Manuell vs. KI inkl. Prüfung'),
    ('60 € pro Stunde', 'Kalkulatorische Personalkosten'),
]):
    x = M+14+i*(CW-28)/3
    text(large, x, 163, 11.1, bold=True)
    text(label, x, 185, 8, MUTED)

text('1. KI-Kosten je beantworteter Frage', M, 232, 13, bold=True)
text('Beispielmodell: OpenAI GPT-5.4 mini über die API, kein ChatGPT-Abonnement.',
     M, 253, 8.7, MUTED)
cost_rows = [
    ('Input', '20.000 Tokens × 0,75 USD / 1 Mio.', f'{de(input_usd, 4)} USD'),
    ('Output', '3.000 Tokens × 4,50 USD / 1 Mio.', f'{de(output_usd, 4)} USD'),
    ('Summe', '0,0285 USD × angenommene 0,90 EUR/USD', f'{de(api_per_question, 5)} €'),
]
for i, (label, calculation, value) in enumerate(cost_rows):
    y = 276+i*23
    box(M, y, CW, 23, '#F5F7FA' if i != 2 else LIGHT)
    text(label, M+9, y+6, 9, bold=i == 2)
    text(calculation, M+79, y+6, 8.9, MUTED)
    text(value, M+CW-82, y+6, 9.1, bold=True)
para('Tokenbudget über alle Modellaufrufe einer Frage: Kontext, Tool-Runden und '
     'zusätzliche KI-Prüfungen; Output inklusive etwaiger Reasoning-Tokens. '
     'Ohne Cache-Rabatte. Mehr Tokens oder andere Modelle verändern die Kosten.',
     M, 351, CW, 8, MUTED, 10.6)

text('2. Zeitwert und Jahreskosten gegenüberstellen', M, 397, 13, bold=True)
text('11.000 Fragen/Jahr × 5 Minuten Zeitgewinn = rund 917 Stunden freie Kapazität.',
     M, 419, 9, MUTED)
annual_rows = [
    ('Rechnerischer Zeitwert: 11.000 × 5/60 Std. × 60 €', f'{de(time_value, 0)} €'),
    ('Abzüglich Enterprise-Jahreslizenz', f'- {de(license_cost, 0)} €'),
    ('Abzüglich KI-API: 11.000 × 0,02565 €', f'- {de(annual_api)} €'),
    ('Abzüglich Infrastruktur: angenommen 200 €/Monat', f'- {de(infrastructure, 0)} €'),
]
for i, (label, value) in enumerate(annual_rows):
    y = 442+i*21
    text(label, M+4, y+4, 9.1, MUTED)
    text(value, W-M-89, y+4, 9.5, bold=True)
    line(M, y+21, W-M, y+21, RULE, .4)
box(M, 534, CW, 56, DEEP)
text(f'{de(net_potential, 0)} €', M+15, 543, 26, WHITE, True)
para('Rechnerisches Jahrespotenzial nach laufenden Kosten.<br/>'
     'Zeitwert, keine garantierte zahlungswirksame Einsparung.',
     M+194, 547, CW-208, 8.7, WHITE, 12)
text(f'Kostendeckung im Beispiel ab rund {de(break_even_minutes)} Minuten Zeitgewinn je Frage.',
     M, 600, 8.7, MUTED)

text('Weitere Vorteile auf einen Blick', M, 631, 13, bold=True)
for i, (title, detail) in enumerate([
    ('Weniger Kontextwechsel', 'Fragen und Antworten direkt im Dashboard.'),
    ('Nachvollziehbare Analysen', 'Quellen und Tool-Aufrufe sichtbar.'),
    ('Wiederverwendbare Standards', 'Gemeinsame Vorlagen und Definitionen.'),
    ('Gezielte Zugriffskontrolle', 'Benutzer, Modelle und Quellen freigeben.'),
]):
    x = M+(i%2)*(col_w+col_gap)
    y = 655+(i//2)*35
    text(title, x, y, 9.6, bold=True)
    text(detail, x, y+15, 8, MUTED)

para('<b>Annahmen, keine Messwerte:</b> Alle Eurobeträge netto; Wechselkurs nur Rechenannahme. '
     'Einführung, Schulung, laufende Administration, optionale externe Tool-Gebühren und '
     'Steuern sind nicht eingerechnet. Regionale/API-Zuschläge ggf. zusätzlich. '
     'Reale Nutzung, Qualität und Prüfaufwand im Pilot messen; Zeitgewinn ist nur bei nutzbarer '
     'freier Kapazität wirtschaftlich wirksam.', M, 735, CW, 7.4, MUTED, 9.5)
text('Preisquelle: OpenAI API, GPT-5.4 mini · abgerufen am 15.09.2026', M, 778, 7.6, BLUE)
c.linkURL('https://developers.openai.com/api/docs/models/gpt-5.4-mini',
          (M, H-791, W-M, H-776), relative=0)
footer(4)
c.save()

html = '''<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>OpenVizPilot: ein Chat, zwei Fragen, zwei Wege</title><style>body{margin:0;padding:32px;background:#fff;color:#18212f;font-family:Arial,sans-serif}main{max-width:1100px;margin:auto}h1{font-size:28px;letter-spacing:0}svg{width:100%;height:auto}p{color:#526071}</style>
<main><h1>OpenVizPilot: ein Chat, zwei Fragen, zwei Wege</h1><p>Fragen und Antworten bleiben im selben Chatfenster im Dashboard. Persönliche Anmeldung und separate Admin-Freigaben für KI und Tableau-API.</p>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1100 345" role="img" aria-labelledby="ovp-flow-title ovp-flow-desc">
<title id="ovp-flow-title">Ein gemeinsamer Chat mit zwei Datenwegen</title>
<desc id="ovp-flow-desc">Im selben OpenVizPilot-Chat führen Fragen zum Dashboard über die Extensions API und Fragen zu Felddefinitionen über die Tableau Server APIs zum KI-Modell. Die Antwort mit Quellen kehrt in dasselbe Chatfenster zurück.</desc>
<defs><marker id="ovp-flow-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0 0L6 3L0 6Z" fill="#526071"/></marker></defs>
''' + '\n'.join(svg) + '''</svg><p>Vereinfacht: Die KI veranlasst gezielte Tool-Abfragen. Benötigter Datenkontext und Metadaten werden an den konfigurierten KI-Anbieter übertragen. Tableau-Rechte und Lizenzen bleiben zusätzlich erforderlich.</p></main></html>'''
(OUT / 'source/OpenVizPilot-KI-Ablauf.html').write_text(html, encoding='utf-8')
reader = PdfReader(str(pdf))
assert len(reader.pages) == 4
extracted = '\n'.join(page.extract_text() for page in reader.pages)
for expected in ['14.500 €', 'netto', 'trägt der Kunde', 'dasselbe Chatfenster', 'Open Core', 'Enterprise', 'Tableau-Cluster', 'Benutzerfreigaben', 'Metadata']:
    assert expected in extracted, expected
assert '19.500' not in extracted and 'brutto' not in extracted
for expected in ['37.818 €', '282,15', '55.000', '0,02565', 'keine Messwerte', 'Benutzer und Freigaben', '4/4']:
    assert expected in extracted, expected
print(f'Created {pdf}: 4 pages; required content and example calculations verified.')
