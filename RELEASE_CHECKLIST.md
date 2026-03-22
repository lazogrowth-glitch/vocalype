# Release Checklist

## Regle simple

- Dev qui change souvent = mode souple
- Release publique = mode strict

## Pendant le dev

Utiliser ces variables Railway:

```env
LICENSE_STRICT_BUILD_APPROVAL=0
LICENSE_ALLOW_DEBUG_BUILDS=1
LICENSE_ALLOWED_CHANNELS=stable,dev
LICENSE_APPROVED_BUILD_HASHES=
```

But:

- laisser l'app evoluer sans se bloquer soi-meme
- garder les logs d'anomalies
- ne pas casser les builds de test

## Quand tu prepares une vraie release publique

1. Builder la release Windows finale
2. Recuperer le hash SHA-256 du `.exe` ou du setup officiel
3. Mettre ce hash dans Railway
4. Passer Railway en mode strict

Variables Railway:

```env
LICENSE_STRICT_BUILD_APPROVAL=1
LICENSE_ALLOW_DEBUG_BUILDS=0
LICENSE_ALLOWED_CHANNELS=stable
LICENSE_APPROVED_BUILD_HASHES=ton_hash_release
```

## Commande Windows pour recuperer le hash

```powershell
Get-FileHash "C:\chemin\vers\Vocalype.exe" -Algorithm SHA256
```

Ou pour le setup:

```powershell
Get-FileHash "C:\chemin\vers\Vocalype_0.7.17_x64-setup.exe" -Algorithm SHA256
```

## Quand tu sors une nouvelle version plus tard

1. Builder la nouvelle release
2. Recuperer le nouveau hash
3. Ajouter le nouveau hash dans Railway
4. Deployer
5. Supprimer les anciens hash quand tout est stable

Exemple temporaire:

```env
LICENSE_APPROVED_BUILD_HASHES=hash_v1,hash_v2
```

Puis plus tard:

```env
LICENSE_APPROVED_BUILD_HASHES=hash_v2
```

## Phrase a retenir

```text
DEV = souple
PUBLIC = strict
```
