# Vocalype Brain Launcher

Les lanceurs Windows de Brain vivent maintenant dans `internal/brain/launcher/`.

Fichiers principaux :

- `Lancer_Vocalype_Brain.bat`
- `Voir_Rapport_Vocalype_Brain.bat`
- `Voir_Rapports_Vocalype_Brain.bat`
- `Stop_Vocalype_Brain.bat`
- `Lancer_Agent_Vocalype_Auto.bat`
- `Generer_Mission_Claude.bat`
- `Creer_Context_DeepSeek.bat`
- `Enregistrer_Resultat.bat`

Usage :

1. Double-cliquer sur `Lancer_Vocalype_Brain.bat` pour lancer Brain et ouvrir les livrables generes.
2. Double-cliquer sur `Voir_Rapport_Vocalype_Brain.bat` pour ouvrir le dernier rapport et afficher un resume en terminal.
3. Double-cliquer sur `Stop_Vocalype_Brain.bat` pour demander un arret propre apres le cycle en cours.

Important :

- Le mode par defaut reste `proposal_only`.
- Le lanceur d'arret ne tue pas tous les process Python.
- L'arret passe par `internal/brain/data/stop_night_shift.request`.
- Night Shift met a jour `internal/brain/data/night_shift_status.json`.
