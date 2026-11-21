// Écran « Rapport », repris de la source : plage « Du » / « Au » (bornes
// incluses, sans limite ; « Au » vide vaut une seule Journée), puis le total
// sur la période et une carte par Journée (AAAA-MM-JJ, de la plus ancienne à la
// plus récente) avec son total et ses lignes Activité, Projet · Login, Durée en
// hh:mm:ss. Champs date maison jj.mm.aaaa (ADR-0022, E27). L'agrégation (ordre
// E23, Chronomètres exclus, plage inversée vide) est faite par l'API avec
// `shared/`.
import { type ReportDto, formatSeconds, parseEnteredReportRange } from '@app/shared';
import { type FormEvent, useState } from 'react';
import { request } from '../api';
import { useLanguage } from '../i18n/i18n';
import { useNotifyError } from '../notifications';

export function ReportPage() {
  const { t } = useLanguage();
  const notifyError = useNotifyError();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [dateError, setDateError] = useState(false);
  const [report, setReport] = useState<ReportDto | null>(null);

  // Comme dans la source, rien n'est lancé sans « Du ». Une date illisible est
  // signalée sous le formulaire, sans appel au serveur (ADR-0022).
  async function generate(event: FormEvent) {
    event.preventDefault();
    const range = parseEnteredReportRange(from, to);
    if (!range) return;
    if ('error' in range) {
      // Le Rapport précédent ne correspond plus à la saisie : il est masqué.
      setDateError(true);
      setReport(null);
      return;
    }
    setDateError(false);
    try {
      setReport(await request<ReportDto>(`/reports/range?${new URLSearchParams(range)}`));
    } catch (error) {
      notifyError(error);
    }
  }

  return (
    <div className="page">
      <h1>{t('NAV_RAPPORT')}</h1>

      <section className="card rapport__filtre">
        <form className="inline-form" onSubmit={generate}>
          <label className="field-group">
            {t('RAPPORT_CHAMP_DU')}
            <input
              className="field"
              type="text"
              inputMode="numeric"
              placeholder={t('CHAMP_DATE_FORMAT')}
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
          </label>
          <label className="field-group">
            {t('RAPPORT_CHAMP_AU')}
            <input
              className="field"
              type="text"
              inputMode="numeric"
              placeholder={t('CHAMP_DATE_FORMAT')}
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
            <span className="field-hint">{t('RAPPORT_INDICE_JOURNEE_UNIQUE')}</span>
          </label>
          <div className="rapport__actions">
            <button type="submit" className="btn btn-primary">
              {t('RAPPORT_BOUTON_GENERER')}
            </button>
          </div>
        </form>
        {dateError && (
          <p className="banner-error" role="alert">
            {t('CHAMP_DATE_ERREUR_INVALIDE')}
          </p>
        )}
      </section>

      {report ? (
        <>
          <div className="stat-row">
            <div className="stat-row__item">
              <span className="stat-row__valeur">{formatSeconds(report.totalSeconds)}</span>
              <span className="stat-row__label">{t('RAPPORT_SUR_PERIODE')}</span>
            </div>
          </div>

          {report.days.map((reportDay) => (
            <section className="card rapport__jour" key={reportDay.day}>
              <div className="rapport__jour-entete">
                <h2 className="rapport__jour-titre">{reportDay.day}</h2>
                <span className="badge">{formatSeconds(reportDay.totalSeconds)}</span>
              </div>
              <ul className="resource-list">
                {reportDay.lines.map((line) => (
                  <li className="resource-list__item" key={`${line.userId}:${line.projectId}:${line.activityId}`}>
                    <div>
                      <div className="resource-list__nom">{line.activityName}</div>
                      <div className="resource-list__meta">
                        {line.projectName} · {line.userLogin}
                      </div>
                    </div>
                    <span className="badge resource-list__actions">{formatSeconds(line.totalSeconds)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </>
      ) : (
        <p className="resource-list__vide">{t('RAPPORT_MESSAGE_VIDE')}</p>
      )}
    </div>
  );
}
