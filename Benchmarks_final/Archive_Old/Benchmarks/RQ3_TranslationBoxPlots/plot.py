import json, pathlib
import matplotlib
matplotlib.use('Agg')
import pandas as pd
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import matplotlib.ticker as mticker
import numpy as np

HERE   = pathlib.Path(__file__).parent
data   = json.loads((HERE / 'rq2_2_results.json').read_text())
df     = pd.DataFrame(data['results'])

SUBSET = ['createNT', 'splitNT', 'unionNT', 'addLabelToNT', 'dropL', 'renameL', 'renamePk', 'removeProperty']

LABELS = {
    'createNT':       'CREATE NODE TYPE',
    'splitNT':        'SPLIT NODE TYPE',
    'unionNT':        'JOIN NODE TYPE',
    'addLabelToNT':   'ADD LABEL to NODE TYPE',
    'dropL':          'DROP LABEL',
    'renameL':        'RENAME LABEL',
    'renamePk':       'RENAME PROPERTY KEY',
    'removeProperty': 'REMOVE PROPERTY',
}

df = df[df['smo'].isin(SUBSET)].copy()

# Accessible colour palette
C_REFRACT   = '#1E7EA2'   # Hellblau
C_CAMBRIA = '#C09220'   # Hellorange

x       = np.arange(len(SUBSET))
width   = 0.30
offsets = [-width / 2, width / 2]

# same size across all plots
fig, ax = plt.subplots(figsize=(10, 6))
fig.patch.set_facecolor('white')
ax.set_facecolor('white')

def draw_series(metric, color, positions):
    for i, smo in enumerate(SUBSET):
        vals  = df[df['smo'] == smo][metric]
        mean  = vals.mean()
        std   = vals.std()
        ax.bar(
            positions[i], mean, width * 0.80,
            color=color, alpha=0.72,
            edgecolor='white', linewidth=0.8,
            zorder=3
        )
        ax.errorbar(
            positions[i], mean, yerr=std,
            fmt='none', color='#222', linewidth=1.3, capsize=3, zorder=4
        )

draw_series('PerNodeUs',   C_REFRACT,   x + offsets[0])
draw_series('cambriaPerNodeUs', C_CAMBRIA, x + offsets[1])

# Log scale
ax.set_yscale('log')
ax.set_ylim(0.08, 100)
ax.yaxis.set_major_formatter(mticker.FuncFormatter(
    lambda v, _: f'{v:g}' if v >= 1 else f'{v:.2f}'
))
ax.grid(True, axis='y', which='both', alpha=0.25, linestyle='--', color='#ccc')

# Axes
ax.set_xticks(x)
ax.set_xticklabels([LABELS[s] for s in SUBSET], fontsize=10, rotation=15, ha='right')
ax.set_ylabel('Translation time  (us / node)  —  log scale', fontsize=12)

# Legend
legend_handles = [
    mpatches.Patch(facecolor=C_REFRACT,   alpha=0.75, label='REFRACT lazy lens'),
    mpatches.Patch(facecolor=C_CAMBRIA, alpha=0.75, label='Cambria (applyLensToDoc)'),
]
ax.legend(handles=legend_handles, fontsize=10.5, loc='upper right',
          framealpha=0.93, edgecolor='#ccc', facecolor='white')

fig.subplots_adjust(left=0.10, right=0.98, top=0.90, bottom=0.15)
out = HERE / 'rq2_subset_boxplot.png'
fig.savefig(out, dpi=150)
print(f'Saved {out}')
plt.close()
