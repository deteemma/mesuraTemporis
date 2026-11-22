# ADR-0026 — Logo, nom « Mesura Temporis » et vidéo de présentation au survol

- **Statut** : accepté
- **Date** : 2026-11-22
- **S'écarte de** : la source (conversion à l'identique, ADR-0020), sur l'en-tête du menu latéral et le titre de l'onglet

## Contexte

La source affiche en haut du menu latéral une pastille « MT » suivie de « mesuraTemporis ». La responsable fonctionnelle souhaite un logo, et qu'une vidéo de présentation (`mesuratemporis-loop.mp4`, produite hors de ce dépôt) se lance au survol. Le logo reprend le « o » de la vidéo : un cadran à aiguille rouge. Un prototype a comparé trois pictogrammes et deux présentations de la vidéo (branche `prototype/logo-video`).

## Décision

- **Nom affiché** : « Mesura Temporis », dans le menu et dans l'onglet du navigateur. `mesuraTemporis` reste le nom technique. Nom propre : il n'est pas traduit.
- **Logo** : le cadran gris foncé à aiguille rouge, posé sur le fond du menu, à la place de la pastille « MT ». Non cliquable.
- **Vidéo** : au survol de la souris ou au focus clavier du logo, elle s'ouvre dans un cadre d'environ 480 × 270 à droite du logo, par-dessus la page. Elle repart du début, tourne en boucle et reste muette. Elle se ferme dès que le logo est quitté, par un fondu d'environ 0,15 s.
- **Jamais** au toucher, au clic, ni pour un utilisateur qui demande moins d'animations.
- **Écrans étroits** : le menu latéral y est masqué, donc ni logo ni vidéo ; la barre basse ne change pas.
- **Fichier** : la vidéo est copiée dans l'application web. Le dossier de production de la vidéo reste la source.

## Conséquences

- L'en-tête du menu et le titre de l'onglet ne sont plus identiques à la source.
- Si la vidéo est refaite, il faut la recopier à la main dans `web/public/`.
- La vidéo (1,6 Mo) est téléchargée au premier survol ; le cadre peut rester noir un court instant.
- L'application mobile n'est pas concernée.

> Rappel : un ADR accepté n'est jamais modifié de sa propre initiative. Pour le
> faire évoluer, on propose un nouvel ADR et on attend une validation explicite.
