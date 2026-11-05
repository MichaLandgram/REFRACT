import json, pathlib
import matplotlib
matplotlib.use('Agg')
import pandas as pd
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import matplotlib.ticker as ticker
import numpy as np

HERE   = pathlib.Path(__file__).parent
data   = json.loads((HERE / 'rq2_2_results.json').read_text())
df     = pd.DataFrame(data['results'])

SUBSET = ['createNT', 'splitNT', 'unionNT', 'addLabelToNT', 'dropL', 'renameL', 'renamePk', 'removeProperty']

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

C_REFRACT   = '#1E7EA2'
C_CAMBRIA = '#C09220'
C_EAGER   = '#5B2C82'

x       = np.arange(len(SUBSET))
width   = 0.30
offsets = [-width / 2, width / 2, width / 2 + width]


# same size across all plots
fig, ax = plt.subplots(figsize=(10, 6), constrained_layout=True)
fig.patch.set_facecolor('white')
ax.set_facecolor('white')

def draw_series(metric, color, positions):
    for i, smo in enumerate(SUBSET):
        vals  = df[df['smo'] == smo][metric]
        mean  = vals.mean() if not vals.empty else 0
        std   = vals.std() if not vals.empty else 0
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
# draw_series('eagerPerNodeUs', C_EAGER, x + offsets[2])

ax.set_yscale('log')
ax.yaxis.set_major_formatter(ticker.ScalarFormatter())
ax.yaxis.get_major_formatter().set_scientific(False)
ax.yaxis.set_minor_formatter(ticker.NullFormatter())
ax.grid(True, axis='y', which='both', alpha=0.25, linestyle='--', color='#ccc')
ylo, yhi = ax.get_ylim()
ax.set_ylim(ylo, yhi * 1.5)

# Axes
ax.set_xticks(x)
ax.set_xticklabels([LABELS[s] for s in SUBSET], fontsize=9, rotation=10, ha='right')
ax.set_ylabel('Translation time  (us / entity) ', fontsize=12)

# Legend
legend_handles = [
    mpatches.Patch(facecolor=C_REFRACT,   alpha=0.75, label='REFRACT'),
    mpatches.Patch(facecolor=C_CAMBRIA, alpha=0.75, label='Cambria'),
]
ax.legend(handles=legend_handles, fontsize=10.5, loc='upper left',
          framealpha=0.93, edgecolor='#ccc', facecolor='white')


out = HERE / 'ReadOverhead_Boxplot.svg'
fig.savefig(out, dpi=300, bbox_inches='tight')
print(f'Saved {out}')
plt.close()

