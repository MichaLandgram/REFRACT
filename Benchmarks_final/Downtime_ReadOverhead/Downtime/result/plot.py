import json, pathlib
import matplotlib
matplotlib.use('Agg')
import pandas as pd
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import matplotlib.ticker as ticker
import numpy as np

HERE    = pathlib.Path(__file__).parent
RESULT  = HERE / 'Downtime_results.json'
data    = json.loads(pathlib.Path(RESULT).read_text())
df      = pd.DataFrame(data['results'])

SUBSET = [
    'createNT', 'createRT', 'createL',
    'dropNT', 'dropRT', 'dropL',
    'renameL', 'renamePk', 'addLabelToNT',
    'addProperty', 'removeLabel', 'removeProperty',
    'retypeProperty', 'splitNT', 'splitRT', 'splitL',
    'unionNT', 'unionRT','unionL'
]

LABELS = {
    'createNT':       'CREATE(NT)',
    'createRT':       'CREATE(RT)',
    'createL':        'CREATE(L)',
    'dropNT':         'DROP(NT)',
    'dropRT':         'DROP(RT)',
    'dropL':          'DROP(L)',
    'renameL':        'RENAME(L)',
    'renamePk':       'RENAME(P)',
    'addLabelToNT':   'CHANGE: ADD L',
    'addProperty':    'CHANGE: ADD P',
    'removeLabel':    'CHANGE: REMOVE L',
    'removeProperty': 'CHANGE: REMOVE P',
    'retypeProperty': 'CHANGE: RETYPE P',
    'splitNT':        'SPLIT(NT)',
    'splitRT':        'SPLIT(RT)',
    'splitL':         'SPLIT(L)',
    'unionNT':        'JOIN(NT)',
    'unionRT':        'JOIN(RT)',
    'unionL':        'JOIN(L)'
}

df = df[df['smo'].isin(SUBSET)].copy()

# Accessible colour palette
C_REFRACT   = '#1E7EA2'
C_CAMBRIA = '#C09220'
C_EAGER   = '#5B2C82'

METRICS = [
    ('lazyReadyMs',      C_REFRACT,   'REFRACT'),
    ('cambriaReadyMs',   C_CAMBRIA, 'Cambria'),
    ('eagerMigrationMs', C_EAGER,   'Eager'),
]

x       = np.arange(len(SUBSET))
width   = 0.22
offsets = [-width, 0, width]

# same size across all plots
fig, ax = plt.subplots(figsize=(16, 6), constrained_layout=True)
fig.patch.set_facecolor('white')
ax.set_facecolor('white')

bp_handles = []
for (metric, color, label), offset in zip(METRICS, offsets):
    for i, smo in enumerate(SUBSET):
        if smo == 'addProperty' and metric == 'eagerMigrationMs':
            # no mandatory stuff
            continue
        vals  = df[df['smo'] == smo][metric]
        mean  = vals.mean()
        std   = vals.std()

        ax.bar(
            x[i] + offset, mean, width * 0.80,
            color=color, alpha=0.72,
            edgecolor='white', linewidth=0.8,
            zorder=3
        )
        ax.errorbar(
            x[i] + offset, mean, yerr=std,
            fmt='none', color='#222', linewidth=1.3, capsize=3, zorder=4
        )
    bp_handles.append(mpatches.Patch(facecolor=color, alpha=0.75, label=label))

ax.set_xticks(x)
ax.set_xticklabels([LABELS[s] for s in SUBSET], fontsize=9, rotation=10, ha='right')
ax.set_ylabel('Time (ms)', fontsize=12)
ax.set_yscale('log')
ax.yaxis.set_major_formatter(ticker.FormatStrFormatter('%.1f'))
ax.grid(True, axis='y', alpha=0.30, linestyle='--', color='#ccc')

ax.legend(handles=bp_handles, fontsize=10.5, loc='upper left',
          framealpha=0.93, edgecolor='#ccc', facecolor='white')


out = HERE / 'Downtime_Boxplot.svg'
fig.savefig(out, dpi=300, bbox_inches='tight')
print(f'Saved {out}')

plt.close()
