# Vocalype Brain Launcher

Les lanceurs Windows existent en deux endroits :

- a la racine du repo
- sur le Bureau Windows de l'utilisateur courant si la copie a reussi

Fichiers :

- `Lancer_Vocalype_Brain.bat`
- `Voir_Rapport_Vocalype_Brain.bat`
- `Stop_Vocalype_Brain.bat`

Usage :

1. Double-cliquer sur `Lancer_Vocalype_Brain.bat` pour lancer Night Shift puis afficher le resume.
2. Double-cliquer sur `Voir_Rapport_Vocalype_Brain.bat` pour ouvrir le dernier rapport et afficher un resume en terminal.
3. Double-cliquer sur `Stop_Vocalype_Brain.bat` pour demander un arret propre apres le cycle en cours.

Important :

- Le mode par defaut reste `proposal_only`.
- Le lanceur d'arret ne tue pas tous les process Python.
- L'arret passe par `vocalype-brain/data/stop_night_shift.request`.
- Night Shift met a jour `vocalype-brain/data/night_shift_status.json`.
