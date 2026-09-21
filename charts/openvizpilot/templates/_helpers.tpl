{{- define "openvizpilot.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "openvizpilot.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{- define "openvizpilot.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "openvizpilot.labels" -}}
helm.sh/chart: {{ include "openvizpilot.chart" . }}
{{ include "openvizpilot.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "openvizpilot.selectorLabels" -}}
app.kubernetes.io/name: {{ include "openvizpilot.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{/* Name des Secrets, das das Chart selbst anlegt (Klartext-Werte aus values).
     fullname wird vorher gekürzt, damit der Name mit Suffix <= 63 Zeichen bleibt. */}}
{{- define "openvizpilot.envSecretName" -}}
{{ printf "%s-env" (include "openvizpilot.fullname" . | trunc 59 | trimSuffix "-") }}
{{- end -}}

{{/* Name des CloudNativePG-Clusters. Auf 58 Zeichen begrenzt, weil der
     Operator Suffixe anhängt (-app-Secret, -rw/-ro-Services). */}}
{{- define "openvizpilot.dbClusterName" -}}
{{ printf "%s-db" (include "openvizpilot.fullname" . | trunc 55 | trimSuffix "-") }}
{{- end -}}

{{/* Guard gegen das umbenannte litellm.*-Values-Schema (jetzt llm.*). Am
     Anfang jedes Templates mit eigenen required/fail-Checks aufrufen, damit
     die Meldung unabhängig von der Render-Reihenfolge zuerst erscheint. */}}
{{- define "openvizpilot.checkLegacyLitellmValues" -}}
{{- if .Values.litellm }}{{ fail "litellm.* wurde in llm.* umbenannt (siehe README, Configuration from a vault)" }}{{ end }}
{{- end -}}

{{/* image.repository: explizit gesetzt hat Vorrang, sonst abgeleitet aus
     image.edition (core|enterprise). */}}
{{- define "openvizpilot.imageRepository" -}}
{{- if .Values.image.repository -}}
{{- .Values.image.repository -}}
{{- else if eq .Values.image.edition "core" -}}
ghcr.io/bl0rb/openvizpilot
{{- else if eq .Values.image.edition "enterprise" -}}
ghcr.io/bl0rb/openvizpilot-enterprise
{{- else -}}
{{ fail (printf "image.edition muss 'core' oder 'enterprise' sein, ist: %q" .Values.image.edition) }}
{{- end -}}
{{- end -}}

{{/* Das Enterprise-Image ist ein privates GHCR-Paket: ohne imagePullSecrets
     zieht Kubernetes es nicht. Am Anfang von deployment.yaml aufrufen. */}}
{{- define "openvizpilot.checkEnterpriseImagePullSecret" -}}
{{- if and (eq .Values.image.edition "enterprise") (not .Values.imagePullSecrets) -}}
{{ fail "Enterprise-Image ist privat: imagePullSecrets mit dem WerkWorks-Registry-Token setzen" }}
{{- end -}}
{{- end -}}
