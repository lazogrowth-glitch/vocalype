# Vocalype Product Reality

Audit basé sur le repo `v0.7.25`, sur le code Tauri/React/Rust/Flask, sur les rapports d'évaluation Parakeet présents dans `src-tauri/evals/parakeet`, sur les docs internes, et sur l'état actuel des tests.

## 1. Ce que Vocalype fait aujourd’hui réellement

Vocalype est aujourd'hui un produit desktop de dictée vocale avec compte obligatoire, licence locale, téléchargement de modèles, transcription locale ou cloud, puis insertion du texte dans l'application active.

Concrètement, le coeur produit réel est :

- raccourci global pour lancer/arrêter la dictée
- overlay de capture
- transcription locale par défaut avec Parakeet V3
- parcours produit centré sur un seul moteur visible : Parakeet
- post-traitement texte
- historique local avec export
- gating compte/licence/paiement

Ce n’est pas aujourd’hui un assistant vocal général, ni un produit mobile, ni un SaaS web de transcription. Les features `notes`, `meetings`, `stats`, `snippets` existent partiellement dans le code, mais ne sont pas vraiment exposées comme surface produit principale dans l’UI de lancement.

## 2. Plateformes supportées

Support réel :

- Windows desktop : c’est clairement la plateforme la plus avancée et la plus testée dans ce repo.
- macOS desktop : pipeline de release, signing, notarization et permissions prévus, mais la doc interne reconnaît qu’un vrai test manuel sur Mac propre reste nécessaire.
- Linux desktop : support code présent, mais l’injection texte dépend de l’environnement X11/Wayland et parfois d’outils externes (`xdotool`, `wtype`, `ydotool`, `playerctl`).

Support non réel aujourd’hui :

- pas d’application web utilisable comme produit principal
- pas de support iOS/Android malgré des assets/icônes présents

Verdict plateforme : oui, c’est un vrai produit desktop multi-plateforme sur le papier. En pratique, la confiance produit n’est pas homogène hors Windows.

## 3. Modèles STT disponibles et modèle par défaut

Réalité produit visible aujourd’hui :

- l’app utilise réellement Parakeet comme moteur STT exposé
- le modèle produit réel est `parakeet-tdt-0.6b-v3-multilingual`
- au premier onboarding, l’app télécharge puis active ce modèle
- le parcours utilisateur normal ne repose pas sur un vrai choix multi-modèles

Réalité technique en arrière-plan :

- le repo contient encore un catalogue plus large de moteurs et de providers
- mais si ces options sont cachées dans l’app, elles ne comptent pas comme réalité produit actuelle
- elles relèvent plutôt d’une capacité technique résiduelle ou expérimentale

Donc la vérité produit simple est : Vocalype = Parakeet.

## 4. Workflow utilisateur réel de dictée

Workflow réel :

1. L’utilisateur doit avoir un compte et une licence valide. Sans ça, l’app ouvre un portail d’auth browser-first.
2. Une fois l’accès validé, si aucun modèle local n’est prêt, l’app lance un écran de premier téléchargement du modèle Parakeet V3.
3. L’utilisateur déclenche la dictée via raccourci global.
4. L’app vérifie la licence, le warmup micro/modèle, le quota si plan basic, et montre l’overlay.
5. L’audio est capturé, puis transcrit.
6. Le texte passe par un pipeline de nettoyage : fillers, ponctuation, dictionnaire, snippets, éventuellement voice-to-code ou post-process LLM.
7. Si plan premium : tentative d’injection native/paste dans l’app active.
8. Si plan basic : pas d’injection native, texte copié dans le presse-papiers.
9. L’entrée est stockée dans l’historique local.

Ce workflow est réel et câblé. Il n’est pas “instant sans friction” : il dépend du compte, du warmup, du modèle et de la fiabilité du paste selon l’application cible.

## 5. Ce qui marche très bien

- Le coeur local Parakeet V3 sur dictée courte à moyenne en anglais semble réellement bon.
- Le produit a l’avantage d’être resserré sur un seul chemin modèle visible, ce qui évite une UX confuse de sélecteur multi-modèles.
- Les évaluations locales présentes sont solides sur l’anglais naturel :
  - `english-20-pipeline-current.json` : WER 1.65%, latence moyenne 1041 ms
  - `natural-26-pipeline-current.json` : WER 0.67%, latence moyenne 975 ms
- La gestion produit du premier modèle par défaut est claire : l’app pousse vers un modèle unique, cohérent, rapide.
- L’historique local, l’export et la conservation des enregistrements sont de vrais morceaux de produit, pas juste des mocks.
- Le gating basic/premium est cohérent techniquement : pas un simple texte marketing.
- L’app a une vraie profondeur runtime : overlay, tray, warmup, diagnostics, modèles, fallback clipboard, quota, licence offline.

## 6. Ce qui marche moyennement

- Le multilingue existe, mais la confiance n’est pas au niveau de l’anglais.
- La promesse “offline/local” est vraie partiellement, mais pas simple :
  - il faut d’abord compte + licence
  - les modèles locaux premium sont chiffrés/localement scellés
  - l’usage offline repose sur une licence déjà émise et encore valide offline
- L’injection texte n’est pas universellement fiable. Le produit a déjà des fallbacks et plusieurs méthodes de paste, ce qui est bon, mais ça prouve aussi qu’il y a un vrai problème de compatibilité applicative.
- Linux est supporté, mais avec beaucoup de branches conditionnelles et d’outils système différents. C’est du support “ingénierie sérieuse”, pas du support “sans surprise”.
- Les features de notes/réunions existent côté backend, mais elles ne ressemblent pas encore à un produit vraiment assumé dans l’UI principale.

## 7. Ce qui casse encore

- La suite de tests n’est pas verte aujourd’hui.
  - Front : `114 passed / 1 failed`
  - Rust : `309 passed / 2 failed`
- Un test cassé concerne la ponctuation d’un mot unique : le système renvoie `Ok` au lieu de `Ok.`
- Un autre test cassé concerne une finalisation longue avec email/URL tronqués ou dégradés.
- Le repo interne mentionne encore des diagnostics ouverts sur dictée bloquée / stuck recording.
- Les benchmarks de latence de paste après correctif ne sont pas encore consolidés ; le repo le dit lui-même.
- Le focus produit déclaré a basculé vers un pack “recruiting”, mais je ne vois pas dans ce repo un rapport courant de benchmark recruiter-first équivalent aux rapports `english-20`, `natural-26` ou `long-form-18`.

Donc non, l’état actuel n’est pas “clean et stabilisé”.

## 8. Latence observée

Mesures visibles dans le repo pour le modèle par défaut Parakeet V3 :

- pack anglais `english-20` : 1041 ms en moyenne
- pack naturel `natural-26` : 975 ms en moyenne
- pack long form `long-form-18` : 3411 ms en moyenne
- pack combiné `combined-70` : 1559 ms en moyenne

Lecture honnête :

- sur de la dictée courte à moyenne, la latence semble bonne à très bonne
- sur du long form, on n’est plus dans “quasi instantané”
- le premier usage peut être plus lent à cause du warmup modèle/micro
- le repo interne cite aussi au moins une mesure manuelle à 2400 ms pour une dictée

Donc la promesse “rapide” est vraie surtout sur le chemin chaud, avec le bon modèle, sur une machine correcte.

## 9. Qualité transcription observée

Pour Parakeet V3 local, la qualité observée dans les packs locaux est objectivement bonne, surtout en anglais.

Mais il faut nuancer brutalement :

- les packs locaux sont probablement plus favorables au produit que le monde réel complet
- le holdout externe FLEURS est nettement moins flatteur :
  - `external-fleurs-supported-100-no-hi-fullcontext.json` : WER 7.18%
  - `external-fleurs-supported-400-no-hi-recovery-v5-synced.json` : WER 7.49%
- les rapports externes montrent encore omissions, duplications, hallucinations et problèmes de fin de phrase

Conclusion qualité :

- anglais local contrôlé : franchement bon
- long form local : bon mais pas impeccable
- multilingue réel large : correct à bon, pas “best in class” démontré dans ce repo
- la qualité actuelle n’autorise pas un discours trop ambitieux sur la robustesse universelle

## 10. Gestion des longues dictées, pauses, hésitations et bégaiements

Il y a un vrai travail produit ici :

- chunking adaptatif
- bascule possible vers un modèle “long audio”
- seuil adaptatif de silence
- récupération full-audio conditionnelle sur cas suspects
- suppression de fillers
- collapse de certains stutters
- voice profile / adaptive vocabulary

Donc ce sujet n’est pas ignoré. Il est traité sérieusement.

Mais :

- c’est encore beaucoup de logique heuristique
- les longues dictées restent plus lentes
- les fins de phrase restent une zone sensible
- il existe encore des tests cassés sur ce terrain
- nettoyer fillers/hésitations améliore parfois la lisibilité, mais peut aussi masquer ou déformer du parler naturel

En bref : c’est déjà travaillé, mais pas encore “résolu produit”.

## 11. Installation / onboarding / activation

L’onboarding réel n’est pas léger.

- L’app n’est pas une app qu’on ouvre et qu’on essaie anonymement.
- Il faut passer par compte + activation.
- L’auth se fait via navigateur, pas via un flow inline natif simple.
- Ensuite il faut souvent télécharger le modèle local.
- Ensuite il faut warmup/permissions/micro.

Sur macOS, les permissions système sont un vrai sujet produit.
Sur Linux, les dépendances système et les outils d’injection rendent l’expérience potentiellement plus fragile.

Verdict onboarding : fonctionnel, mais trop lourd pour être perçu comme “frictionless”.

## 12. Paiement / licence / compte

La vérité actuelle est assez claire :

- inscription = trial premium 14 jours, sans carte
- après le trial, l’utilisateur ne perd pas totalement l’accès
- il passe en plan `basic`
- le basic garde l’accès à la dictée, mais avec limite hebdomadaire de 30 transcriptions
- le basic copie au presse-papiers au lieu d’injecter nativement
- le premium est nécessaire pour l’injection native, le téléchargement de modèles locaux premium, et la transcription de fichiers audio

Donc Vocalype n’est pas “gratuit offline”. C’est un produit desktop sous contrôle de compte/licence, avec une version basic bridée mais réelle.

## 13. Privacy / offline / local : ce qui est vrai aujourd’hui

Ce qui est vrai :

- audio et transcriptions restent localement par défaut
- historique et enregistrements sont stockés en local
- l’app ne prétend pas envoyer les dictées au serveur Vocalype par défaut
- la validation de licence n’envoie que des métadonnées minimales côté compte/device

Ce qui n’est pas totalement “offline-first” :

- il faut un compte au départ
- il faut une licence stockée localement pour continuer hors ligne
- les modèles locaux premium sont protégés par la licence
- si l’utilisateur choisit Gemini/Groq/Mistral/Deepgram, l’audio part bien dans le cloud fournisseur

Verdict privacy/local :

- oui, le chemin local existe vraiment
- non, ce n’est pas un produit local-anonyme-indépendant du serveur

## 14. Ce qui est encore incomplet ou fragile

- suite de tests non verte
- validation cross-platform inégale
- dépendance forte au backend auth/licence pour la première expérience
- fiabilité de paste encore contextuelle selon l’app cible
- qualité multilingue moins rassurante que la qualité anglais locale
- métriques produit réelles encore incomplètes sur certains sujets clés
- notes/meetings/stats présents en profondeur de code mais pas encore assumés comme surface produit stable
- beaucoup de sophistication runtime, donc beaucoup de surface de panne

## 15. Les 10 risques qui peuvent faire perdre confiance à un recruteur

1. Le produit exige compte, activation, licence et téléchargement avant la première vraie dictée. Ça sent le produit encore lourd.
2. Les tests sont cassés aujourd’hui. Un recruteur technique qui vérifie ça voit immédiatement un niveau de finition insuffisant.
3. Le produit promet multi-plateforme, mais le niveau de confiance réel semble surtout bon sur Windows.
4. La promesse “offline/local” est vraie, mais seulement après passage par le système de compte/licence. Dit trop simplement, ça ressemble à une demi-vérité.
5. Le plan basic/premium change le comportement clé du produit : injection native vs simple clipboard. Si ce n’est pas expliqué parfaitement, ça crée de la déception.
6. Les longues dictées sont nettement plus lentes que les dictées courtes. Le produit n’est pas uniformément “instantané”.
7. Les benchmarks externes multilingues ne sont pas assez dominants pour soutenir un discours très confiant sur la qualité universelle.
8. Le repo montre encore des zones de diagnostic ouvertes sur stuck recording / paste latency / activation robustness.
9. Des pans du produit existent à moitié en surface : notes/meetings/stats donnent une impression de produit pas totalement resserré.
10. La sophistication du runtime est élevée. C’est impressionnant techniquement, mais ça augmente aussi le risque de comportements imprévisibles en situation réelle.

## 16. Verdict honnête : prêt pour pilote, prêt pour beta, ou pas encore vendable

Verdict honnête : pas encore vendable.

Version longue :

- oui, il y a un vrai produit ici
- oui, le coeur dictée locale est déjà sérieux
- oui, certaines métriques sont franchement bonnes
- mais non, l’ensemble n’inspire pas encore une confiance froide de produit fini

Je le classerais comme :

- acceptable pour tests privés ou pilotes founder-led
- peut-être acceptable pour une beta privée avec utilisateurs tolérants
- pas assez propre, stable et simple pour être vendu sans réserves à des recruteurs comme produit déjà mature

Le principal problème n’est pas l’absence de technologie.
Le principal problème est l’écart entre la sophistication interne et la robustesse perçue de bout en bout.
