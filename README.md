# Encadrement projet

Application de bureau (Electron) pour :

1. **Lire des agendas iCal** à partir de leur URL (le téléchargement passe par le
   processus Node de l'application : pas de blocage CORS). On peut aussi coller
   directement le contenu `.ics`.
2. **Afficher les agendas dans un planning en liste**, groupé par jour, filtrable
   par agenda / type / texte, exportable en CSV.
3. **Comparer les agendas** pour trouver les **périodes communes** — créneaux où
   tout le monde est libre, ou au contraire tous occupés — dans une fenêtre de
   travail paramétrable (jours + heures).
4. **Répartir les enseignants sur les séances de projet** : au moins un
   enseignant par séance de 4 h, uniquement quand il est libre, avec équilibrage
   de la charge et prise en compte de **périodes préférées (en mois)** par
   enseignant.

## Installation

```bash
cd projet-encadrement
npm install
npm start
```

Générer un exécutable :

```bash
npm run dist:win      # NSIS + portable (Windows)
npm run dist:mac      # dmg
npm run dist:linux    # AppImage
```

Le résultat est dans `dist/`.

## Notice utilisateur

Une notice d'utilisation destinée aux utilisateurs finaux (pas aux
développeurs) : [`docs/notice.pdf`](docs/notice.pdf), générée depuis
[`docs/notice.html`](docs/notice.html) par :

```bash
npm run notice      # -> docs/notice.pdf (rendu A4 via Electron)
```

## Utilisation

### 1. Onglet *Agendas*
Ajoutez chaque flux iCal : un **nom**, un **type** (*Enseignant* ou *Projet*) et
l'**URL**. Cliquez sur *Ajouter* : l'agenda est chargé immédiatement.
La **plage analysée** (barre du haut, « Du … au … ») borne l'expansion des
événements récurrents — réglez-la sur la durée du projet (par défaut : mois
courant → +9 mois).

**Plusieurs agendas par encadrant (ou par projet)** : un encadrant ou un
projet suit rarement un seul calendrier (agenda personnel + agenda
d'établissement, par exemple). Dans sa carte, *+ ajouter un agenda* ajoute une
nouvelle URL (ou un nouveau contenu `.ics` collé) ; *retirer* en supprime une
(dès qu'il y en a plus d'une). Tous les événements de tous les agendas d'une
même carte sont fusionnés pour ce compte — le reste de l'application (planning,
disponibilités, affectation) n'y voit que du feu.

**Import en lot (Excel)** :
- *Télécharger le modèle Excel* produit un `.xlsx` avec les colonnes **Nom**,
  **Projet ou encadrant**, **Encadrement (total / partiel)**, **Heures totales**,
  **Heures encadrées**, **% séances encadrées**, **Adresse iCal 1**,
  **Adresse iCal 2**, **Adresse iCal 3** (+ une feuille *Notice*) — jusqu'à 3
  agendas par ligne ; d'autres colonnes numérotées (*Adresse iCal 4*, ...) sont
  aussi reconnues si besoin.
- *Importer un tableau (.xlsx)* lit un fichier rempli et crée les agendas. Une
  ligne dont le **nom** correspond à un agenda existant le met à jour : les
  adresses iCal qu'elle apporte et qui ne sont pas déjà enregistrées sont
  **ajoutées** à ses agendas existants (aucun n'est jamais retiré par un
  import). Les en-têtes sont reconnus de façon tolérante (accents, casse,
  quelques synonymes) ; les lignes douteuses sont importées mais listées en
  avertissement.

Les agendas importés restent **entièrement modifiables** dans cet onglet.

Partout dans l'application, encadrants et projets sont affichés **par ordre
alphabétique** (accents et casse ignorés, tri naturel des nombres) ; l'ordre
d'ajout est conservé en interne mais n'a aucune incidence.

*Supprimer tous les encadrants* / *Supprimer tous les projets* (au-dessus de
chaque liste, avec confirmation) vident d'un coup toute une catégorie —
pratique pour repartir d'une base propre. La suppression nettoie aussi les
réglages qui pointaient sur les agendas retirés (colonne dans la matrice
équipe/poids, périodes préférées, séances verrouillées).

Pour un agenda de type **Enseignant**, on peut saisir directement (sans passer
par l'Excel) des **indisponibilités récurrentes en demi-journées** : une ligne
par demi-journée (elles n'ont pas besoin d'être contiguës — p. ex. *lun. matin*
et *mar. après-midi*), chacune avec son **degré**. Les demi-journées vont de
*lun. matin* à *ven. après-midi*, coupure du midi à 12 h.
- **1 — à éviter** : l'affectation automatique n'y place une séance qu'en
  dernier recours, si aucun autre encadrant n'est possible ;
- **2 — bloqué** : aucune séance n'y est jamais placée automatiquement (comme
  une indisponibilité d'agenda). Un choix manuel reste possible mais est
  signalé « indispo (récurrent) ».

Pour un agenda de type **Projet**, on choisit son mode d'**encadrement** :
- *total* — chaque séance doit avoir un encadrant (défaut) ;
- *partiel* — des séances peuvent rester sans encadrant. La cible d'heures *non*
  encadrées s'exprime au choix (champ *Répartition*) :
  - **en heures** : *heures totales* − *heures encadrées* ;
  - **en % de séances encadrées** : `X %` ⇒ `volume horaire × (1 − X/100)`.

  L'affectation automatique laissera volontairement ce volume d'heures sans
  encadrant, en commençant par les séances les plus difficiles à pourvoir ; les
  gaps qu'elle ne peut pas combler ne sont pas comptés comme un problème. Un
  poids dans la colonne *Sans encadrant* de la matrice l'emporte sur ce réglage.

### 2. Onglet *Planning (liste)*
Vue chronologique de tous les événements des agendas actifs. Filtres par type,
par agenda, recherche plein texte. Bouton *Exporter CSV*.

### 3. Onglet *Périodes communes*
Cochez ≥ 2 agendas, choisissez :
- *Créneaux libres communs* : moments où **aucun** des agendas n'a d'événement,
  dans la fenêtre horaire de travail ;
- *Créneaux occupés communs* : intersection des périodes occupées.

Réglez les heures (par défaut 8 h–20 h) et les jours (par défaut lun–ven), puis
*Calculer*. Résultat groupé par jour + export CSV.

### 4. Onglet *Affectation*

**Séances** = tous les événements (hors journée entière) des agendas de type
*Projet*. Chaque séance affiche sa durée ; un badge signale les durées qui
s'écartent de la durée cible.

**Bilan par projet** : un tableau récapitulatif, une ligne par projet (badge
*total* / *partiel*, + ligne *Total* si plusieurs projets) :
- *Séances*, *Couvertes* ;
- *Manque* (séances sous le minimum alors qu'un encadrement est attendu — rouge) ;
- *Sans encadrant* : nombre de séances laissées sans encadrant ; pour un projet
  *partiel*, aussi `heures effectives / cible` (orange si la cible est dépassée) ;
- *Partielles* (au moins un encadrant affecté n'est libre que sur une partie de
  la séance) ;
- *À arbitrer* (au moins 2 encadrants éligibles libres sur toute la séance) ;
- *Heures affectées* (somme `nb encadrants × durée` sur les séances du projet).

**Équipe par projet & poids des encadrants** : un tableau projets × enseignants,
plus une colonne **Sans encadrant**. Chaque case a une **coche** (« concerné par
le projet ») et un **poids relatif** (1 par défaut). Coche décochée = exclu du
projet. Aucune coche sur un projet = tous les enseignants éligibles, poids 1.

Les **poids définissent le nombre de séances** de chaque encadrant. Pour un
projet, la *part* de chacun = `poids / somme des poids du projet` (la colonne
*Sans encadrant* entre dans cette somme), appliquée au volume horaire du projet :
- part de l'encadrant × volume × *nombre cible d'encadrants* = sa **cible d'heures** ;
- part de *Sans encadrant* × volume = les **heures non encadrées** visées
  (équivalent, dans la matrice, du réglage *Heures totales / encadrées* de
  l'onglet Agendas — la matrice l'emporte si elle est renseignée).

Comme un encadrant présent sur plusieurs projets **cumule** une cible de chacun,
son total de séances croît avec le nombre de projets qu'il encadre et avec ses
poids. Le même barème compare donc les encadrants d'un projet entre eux, les
projets entre eux, et « avec ou sans encadrant ».

Sous chaque case : `N aff.` (séances affectées) · `cible ≈` (d'après les poids) ·
`dispo : X compl. + Y part.` (séances où l'encadrant est libre). Le bloc
*Enseignants & périodes préférées* affiche pour chaque encadrant `n séances · h ·
cible ≈ k (H h)` avec un repère de cible sur la barre de charge, et — s'il est
sur plusieurs projets — le détail `Projet A — n séances (cible ≈ …)`.

Un encadrant non coché forcé à la main est signalé « hors équipe ».

**Enseignants** = agendas de type *Enseignant*. Pour chacun :
- un **plafond d'heures** optionnel ;
- des **périodes préférées** : une ou plusieurs plages `mois de début → mois de
  fin`. Une séance qui tombe dans une plage préférée est prioritairement confiée
  à cet enseignant.

**Bouton *Affecter automatiquement*** : lance l'algorithme.

Réglages (valeurs par défaut, réglables dans *Réglages*) :

| Paramètre | Défaut | Rôle |
|---|---|---|
| Nombre cible d'encadrants par séance | 1 | nombre d'encadrants visé par séance |
| Nombre minimum d'encadrants par séance | 1 | en-dessous → séance « manque » (rouge), sauf séance déclarée sans encadrant ou projet en encadrement partiel |
| Durée cible (h) | 4 | badge « ≠4h » + calcul « X h sur 4 h » de disponibilité |
| Durée max d'une séance (h) | 12 | au-delà, l'événement du projet n'est pas une séance (écarte les blocs « vacances » / multi-jours de Pronote) |
| Poids préférence | 1 | force donnée à une période préférée dans le score |
| Respecter le plafond | non | si activé, ne dépasse jamais le plafond d'un enseignant |
| Journée entière = indispo | oui | un événement « journée entière » rend l'enseignant indisponible |

Un panneau dépliable *« À quoi servent ces réglages ? »* reprend ces explications
dans l'onglet.

**Algorithme** (glouton, deux tiers de disponibilité) :
1. Les affectations **verrouillées** (choisies à la main) sont posées d'abord et
   jamais déplacées.
2. **Séances sans encadrant** : celles déclarées à la main, plus — pour un projet
   en encadrement *partiel* — assez de séances pour atteindre son quota d'heures
   non encadrées (les plus difficiles à pourvoir puis les plus tardives d'abord).
   Elles sont retirées de la file d'affectation.
3. Séances restantes traitées dans l'ordre chronologique. Pour chacune, on retient
   les encadrants **membres de l'équipe** ayant **au moins une partie** du
   créneau libre (agenda + séances déjà affectées), et sous leur plafond si
   l'option est active.
4. On remplit d'abord avec les encadrants **libres sur toute la séance** ; on ne
   se rabat sur un encadrant **partiellement** disponible que si aucun encadrant
   pleinement disponible ne reste.
5. Dans le tiers retenu, on prend l'encadrant au meilleur score
   `poids_préférence × (période préférée ? 1 : 0) × durée_cible + (cible d'heures
   de l'encadrant − heures déjà affectées)` : à égalité de préférence, celui qui
   est le **plus loin sous sa cible** (donc, à la longue, une répartition
   proportionnelle aux poids).
6. Passe de rééquilibrage : on transfère une séance non verrouillée de
   l'encadrant le plus **au-dessus** de sa cible vers le plus **en-dessous**,
   tant que cela rapproche les deux de leurs cibles.
7. Une séance qu'aucun encadrant ne peut prendre est comptée « manque » (rouge)
   pour un projet en encadrement *total*, et « sans encadrant » (neutre) pour un
   projet en encadrement *partiel*.

**Déclarer une séance sans encadrant** : dans la colonne *Encadrant(s)*, la case
*« séance sans encadrant »* vide les encadrants de la séance et la sort du calcul
(fond hachuré gris, statut neutre « sans encadrant », non comptée en « manque »).
Décocher la case, ou choisir un encadrant dans le menu, la réintègre. C'est une
option à part entière de l'algorithme : les projets en encadrement partiel en
produisent automatiquement pour tenir leur quota d'heures non encadrées.

**Répartition des séances** — trois vues, sélecteur *Vue :* en haut du bloc :
- **Par séance** : toutes les séances dans l'ordre chronologique (vue éditable) ;
- **Par projet** : mêmes lignes, groupées sous un en-tête par projet (éditable) ;
- **Par encadrant** : pour chaque encadrant, un récapitulatif **par projet**
  (`Projet A — n séances · X h`), sa cible d'après les poids, puis la liste de ses
  séances avec sa couverture (complète / partielle) — synthèse en lecture seule.

Chaque date est précédée du **nom du jour** et suivie du **numéro de semaine
ISO** (`ven. 18/09/2026 · S38`) — même format dans le rapport PDF et les
exports CSV / ICS. Sous le titre :
- des **boutons *Projets :*** pour n'afficher que certains projets (+ *tous* /
  *aucun*) — ce choix commande aussi l'*Export PDF (projets visibles)* ;
- une case **« seulement les séances sans encadrant pleinement disponible »** :
  ne garde que les séances où aucun encadrant éligible n'est libre sur toute la
  durée (celles à arbitrer en priorité).

**Séance à déplacer** : le bouton *à déplacer* (colonne *Séance*) met la séance
**de côté** — l'affectation automatique l'ignore complètement (aucun encadrant
placé, pas comptée dans « manque encadrant »). Elle **reste visible dans tous
les bilans** (bilan par projet, bilan par séance, répartition par encadrant,
séances par projet — à l'écran comme dans le rapport PDF), marquée *à
déplacer*, mais **ne compte pas** : ni comme séance couverte, ni dans les
*Heures affectées*, ni dans le **total de séances / d'heures de chaque
encadrant**. Elle est incluse dans le décompte *Séances* du projet, avec un
rappel « dont N à déplacer ». Recliquer la réintègre ; les choix manuels
éventuels sont conservés.

**Commentaire par séance** : sous le nom de la séance, une zone de texte libre
enregistre une note (auto-sauvegardée, elle grandit avec le texte). Le
commentaire est repris dans le rapport PDF (`💬 …` sous la séance) et dans les
exports CSV / ICS.

**Autre encadrant (hors liste)** : le champ *autre encadrant* (colonne
*Encadrant(s)*) note quelqu'un qui n'a pas d'agenda dans l'application (vacataire,
intervenant extérieur…). Il **compte pour un encadrant** vis-à-vis du minimum et
de la cible : la séance n'est alors plus « manque » et l'affectation automatique
n'y place personne d'office. Il apparaît en gris « (hors liste) » dans la
Répartition, le rapport et les exports.

**Encadrement validé** : le bouton *encadrement validé* (colonne *Encadrant(s)*)
**fige** la séance sur ses encadrants du moment. Une séance validée :
- garde exactement ses encadrants au prochain *Affecter automatiquement* **et
  après une mise à jour des agendas** (les encadrants sont verrouillés
  individuellement, la séance est ré-ensemencée à l'identique) ;
- n'est jamais comptée « manque », même sous le minimum ;
- s'affiche sur fond vert, statut *validé*, dans la Répartition et le rapport.

Recliquer le bouton lève le blocage. À un niveau plus fin, chaque encadrant
d'une séance porte un bouton `○` / `✓` qui **verrouille ce seul encadrant** (même
effet qu'un choix manuel : conservé au prochain calcul) sans figer toute la
séance.

Fond de ligne (vues *Par séance* / *Par projet*) :
- **rouge** : séance sous le minimum, ou un encadrant affecté totalement
  indisponible sur le créneau ;
- **orange** : un encadrant affecté n'est disponible que sur une partie de la
  séance, ou est hors équipe ;
- **bleu** : au moins **deux** encadrants éligibles sont libres sur **toute** la
  séance → un choix est possible ;
- **hachuré gris** : séance sans encadrant (déclarée, ou encadrement partiel).

Colonne **Disponibilités** : pour chaque encadrant éligible ayant du temps libre
sur le créneau, `nom — X h` (avec sa pastille de couleur ; ⚠ = disponibilité
partielle), du plus disponible au moins disponible. Pour un encadrant seulement
partiellement disponible **ou** totalement écarté, le **motif** est indiqué :
`occupé : <autre projet> — <séance> HH:MM–HH:MM` (conflit inter-projets),
`agenda : <intitulé de l'événement>` ou `indisponible récurrent (demi-journée)`.
Les encadrants éligibles mais bloqués sont listés en fin de cellule
(`non dispo : Nom (motif), …`).

> **Deux projets, une séance simultanée, un encadrant commun** : l'affectation
> automatique place l'encadrant sur la séance **traitée en premier** (ordre
> chronologique ; à heure égale, ordre alphabétique du projet). Il est ensuite
> traité comme occupé pour la séance concurrente de l'autre projet — il n'y
> apparaît plus, et le motif `occupé : <projet> — …` l'explique. Ce n'est pas un
> arbitrage entre les besoins des deux projets : c'est « premier arrivé ».

**Changer / ajouter un encadrant** : dans la colonne *Encadrant(s)*, chaque
encadrant proposé (précédé de sa **pastille de couleur**) est un menu déroulant —
on y choisit un autre enseignant (`★` = période préférée, `— indispo` = aucun
créneau libre, `— X h seulement` = disponibilité partielle, `— hors équipe`) ou
*« — retirer — »*. Le menu *+ ajouter un encadrant…* en ajoute un second. Toute
modification manuelle est verrouillée et survit au prochain *Affecter
automatiquement*.

**Exports** :
- *Export PDF* : un rapport **daté et horodaté** (« Édité le … »), en couleurs
  (bandeaux de section, statuts vert / orange / rouge / gris, pastille de couleur
  par agenda). Contenu : plage de dates, KPI, *Bilan par projet*, *Bilan par
  séance* (une ligne par séance, toutes dates confondues, avec les mêmes
  colonnes que la vue *Par séance* de l'application — dont les
  **disponibilités de tous les encadrants éligibles**, pas seulement de ceux
  affectés), puis *Répartition par encadrant* (séances et heures par projet,
  détail de chaque séance) et *Séances par projet*. Ces deux dernières
  sections affichent **une page par encadrant et une page par projet** (saut
  de page automatique entre chacun, pratique pour distribuer une feuille par
  personne ou par projet). Pour une séance **partiellement encadrée**, le
  rapport précise les **créneaux réellement couverts** (ex.
  `Durand (15:00–17:00)`, et `2 h · 15:00–17:00` dans le détail encadrant). La
  colonne *Disponibilités* du *Bilan par séance* reprend aussi les **motifs**
  d'indisponibilité (voir plus haut). Rendu via une fenêtre Electron hors écran
  (`printToPDF`, A4).
- *Export PDF (projets visibles)* : le même rapport, **limité aux projets cochés**
  dans *Répartition des séances* — pratique pour éditer le bilan d'un seul projet.
- *Export CSV* : le tableau des affectations, avec les colonnes *Autre
  encadrant*, *Statut* (dont `A DEPLACER` / `VALIDE`), *Commentaire* et
  *Disponibilités* ; la date porte le nom du jour et le numéro de semaine.
- *Export ICS* : un événement par séance, encadrants (dont l'« autre encadrant »)
  dans le titre, commentaire éventuel dans la description.

Dans la table des séances à l'écran, une disponibilité partielle affiche aussi
ses créneaux (`13:00–15:00`) sous le menu de l'encadrant et dans la colonne
*Disponibilités*.

### 5. Onglet *Assistant*

Un assistant **100 % local** (aucune donnée envoyée à un service tiers, pas de
clé API). Il ne comprend pas le langage libre : il reconnaît **un ou deux noms
d'encadrant** (tels qu'écrits dans les agendas) **+ une intention** parmi :

| Question | Réponse |
|---|---|
| « séances où *Dupont* peut remplacer *Martin* » | les séances de Martin où Dupont est éligible et libre (toute la séance / partielle avec créneaux / indisponible), avec un bouton **Remplacer** par ligne |
| « rééquilibrer les heures entre *Dupont* et *Martin* » | une proposition de transferts (séances du plus chargé que l'autre peut prendre, pleinement libre), heures avant / après, bouton **Appliquer** |
| « créneaux libres communs de *Dupont* et *Martin* » | l'intersection de leurs disponibilités dans la fenêtre de travail |
| « charge de *Dupont* » / « charge » | heures affectées vs cible (poids), écart |
| « qui est libre le 12/11 après-midi ? » | disponibilités des encadrants à une date (matin / après-midi / soir / journée) |

Les échanges restent affichés (style conversation) et sont sauvegardés avec le
projet ; *Effacer* vide l'historique. Les actions *Remplacer* / *Appliquer*
modifient les affectations (verrouillées) directement.

## Persistance

Le projet (agendas, événements chargés, réglages, périodes préférées,
affectations verrouillées) est sauvegardé automatiquement dans le dossier
`userData` d'Electron. *Exporter* / *Importer* permettent d'échanger un fichier
`.json` autonome.

## Vérification

- `npm test` (`node scripts/smoke.js`) : 142 assertions sur l'arithmétique
  d'intervalles, le parsing iCal (fuseaux, RRULE, journée entière, filtrage par
  plage, style Pronote sans VTIMEZONE en UTC pur), le filtrage des séances
  (journée entière / blocs multi-jours écartés via *durée max*), l'algorithme
  d'affectation (répartition proportionnelle aux poids, poids « sans
  encadrant », cumul multi-projets, disponibilité partielle, encadrement
  partiel en heures ou en %, séances sans encadrant, séances « à déplacer »
  visibles dans les bilans mais hors décompte des heures / séances par
  encadrant, « encadrement validé » figé après recalcul, « autre encadrant »
  hors liste,
  indisponibilités récurrentes en demi-journées), la reconnaissance des
  noms de l'Assistant (homonymes, limites de mot), la migration d'état et le
  modèle / l'import Excel (dont les colonnes *Adresse iCal 1/2/3* — plusieurs
  agendas par ligne).
- `npm run smoke` (`electron . --smoke`) : lance l'app sans fenêtre visible,
  charge les agendas d'exemple via l'IPC réel, exécute une affectation
  automatique, un calcul de périodes communes, un export PDF, l'ajout / retrait
  d'un second agenda iCal sur un encadrant directement dans l'interface, et les
  5 intentions de l'Assistant, et quitte avec le code 0 si aucune erreur JS
  n'est survenue. Le scénario vit dans `scripts/smoke-e2e.js`, à l'écart de
  `main.js`.

**Testé sur de vrais flux Pronote** (IUT) : agendas enseignants et projet réels
— parsing correct (Pronote émet des horaires UTC sans `VTIMEZONE`), affectation
19/19 séances en ~25 ms. Les flux Pronote incluent des blocs « vacances »
multi-jours (jusqu'à 29 jours) en évènements horodatés non journée-entière :
d'où le réglage *Durée max d'une séance* (12 h par défaut, onglet Affectation)
qui les écarte automatiquement des séances.

## Structure

```
main.js                 processus principal : IPC, dialogues fichiers, fenêtre (+ mode --smoke)
lib/ical.js             téléchargement + parsing iCal (ical.js) — module Node testable seul
lib/xlsx.js             modèle + import du tableau d'agendas (exceljs) — module Node testable seul
scripts/smoke-e2e.js    scénario du mode --smoke (isolé de main.js)
preload.js              pont contextIsolation -> window.api
renderer/
  index.html            coquille + ordre de chargement des scripts
  styles.css
  app.js                store, helpers, navigation, chargement des agendas
  boot.js
  lib/
    freebusy.js         arithmétique d'intervalles (union, intersection, complément, fenêtre de travail)
    scheduler.js        run() (affectation) + evaluate() (recalcul après édition manuelle)
    ics-export.js       sérialisation CSV / ICS
  views/
    sources.js          onglet Agendas (+ import Excel)
    planning.js         onglet Planning (liste)
    common.js           onglet Périodes communes
    scheduling.js       onglet Affectation (équipes/poids, répartition, exports CSV/ICS/PDF)
    assistant.js        onglet Assistant (questions d'organisation, local)
```
