import json, pathlib
import matplotlib
matplotlib.use('Agg')
import pandas as pd
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import matplotlib.ticker as ticker
import numpy as np

HERE    = pathlib.Path(__file__).parent
RESULT  = HERE.parent / 'RQ1_GroupedBars' / 'rq1_2_results.json'
data    = json.loads(RESULT.read_text())
df      = pd.DataFrame(data['results'])

SUBSET = ['createNT', 'splitNT', 'unionNT', 'addLabelToNT', 'dropL', 'renameL', 'renamePk', 'removeProperty']

LABELS = {
    'createNT':       'CREATE NODE TYPE',
    'splitNT':        'SPLIT NODE TYPE',
    'unionNT':        'JOIN NODE TYPE',
    'addLabelToNT':   'ADD LABEL to NODE TYPE',
    'dropL':          'DROP LABEL',
    'renameL':        'RENAME LABEL',
    'renamePk':       'RENAME PROPERTY',
    'removeProperty': 'REMOVE PROPERTY',
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
fig, ax = plt.subplots(figsize=(10, 6))
fig.patch.set_facecolor('white')
ax.set_facecolor('white')

bp_handles = []
for (metric, color, label), offset in zip(METRICS, offsets):
    for i, smo in enumerate(SUBSET):
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
ax.set_xticklabels([LABELS[s] for s in SUBSET], fontsize=10, rotation=15, ha='right')
ax.set_ylabel('Time (ms)', fontsize=12)
ax.set_yscale('log')
ax.yaxis.set_major_formatter(ticker.FormatStrFormatter('%.1f'))
ax.grid(True, axis='y', alpha=0.30, linestyle='--', color='#ccc')

ax.legend(handles=bp_handles, fontsize=10.5, loc='upper right',
          framealpha=0.93, edgecolor='#ccc', facecolor='white')

fig.subplots_adjust(left=0.10, right=0.98, top=0.90, bottom=0.15)
out = HERE / 'rq1_subset_boxplot.png'
fig.savefig(out, dpi=150)
print(f'Saved {out}')

plt.close()
