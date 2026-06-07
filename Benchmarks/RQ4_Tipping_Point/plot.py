import json, pathlib
import matplotlib
matplotlib.use('Agg')
import pandas as pd
import matplotlib.pyplot as plt
import numpy as np

HERE = pathlib.Path(__file__).parent
raw  = json.loads((HERE / 'rq4_results.json').read_text())
df   = pd.DataFrame(raw['results'])

SUBSET = ['splitNT', 'addLabelToNT',  'renameL', 'renamePk', ]
LABELS = {
    'renameL':        'RENAME LABEL',
    'renamePk':       'RENAME PROPERTY',
    'addLabelToNT':   'ADD LABEL to NODE TYPE',
    'splitNT':        'SPLIT NODE TYPE',
}
# Accessible Color Mapping
STYLES = {
    'renameL':        {'color': '#C09220', 'linestyle': '-'},
    'renamePk':       {'color': '#1E7EA2', 'linestyle': '-'},
    'addLabelToNT':   {'color': '#9CB41C', 'linestyle': '-'},
    'splitNT':        {'color': '#5B2C82', 'linestyle': '--'},
}
MAX_Q = 200

f1 = df[df['factor'] == 1].copy()

INF_CAP = 999
f1['tippingPoint'] = f1['tippingPoint'].clip(upper=INF_CAP)

# same size across all plots
fig, ax = plt.subplots(figsize=(10, 6))
fig.patch.set_facecolor('white')
ax.set_facecolor('white')

q_range = np.arange(1, MAX_Q + 1)

for smo in SUBSET:
    sub   = f1[f1['smo'] == smo]
    style = STYLES[smo]

    diffs_all = []
    for _, row in sub.iterrows():
        delta   = row['prismQueryMs'] - row['eagerQueryMs']
        diff_q  = row['eagerMigrationMs'] - q_range * delta
        diffs_all.append(diff_q)

    diffs_all = np.array(diffs_all)
    med_line  = np.median(diffs_all, axis=0)
    p25_line  = np.percentile(diffs_all, 25, axis=0)
    p75_line  = np.percentile(diffs_all, 75, axis=0)

    ax.plot(q_range, med_line, color=style['color'], linestyle=style['linestyle'], 
            linewidth=2.4, label=LABELS[smo])
    ax.fill_between(q_range, p25_line, p75_line, color=style['color'], alpha=0.04)

ax.axhline(0, color='#2c3e50', linewidth=1.5, linestyle='--', label='Tipping Point (Break-Even)')


all_medians = []
for smo in SUBSET:
    sub   = f1[f1['smo'] == smo]
    diffs = []
    for _, row in sub.iterrows():
        delta = row['prismQueryMs'] - row['eagerQueryMs']
        diffs.append(row['eagerMigrationMs'] - q_range * delta)
    all_medians.append(np.median(diffs, axis=0))
all_medians = np.array(all_medians)
ymin_data = all_medians.min()
ymax_data = all_medians.max()

padding_y = (ymax_data - ymin_data) * 0.12
ymin = ymin_data - padding_y
ymax = ymax_data + padding_y
ax.set_ylim(ymin, ymax)


ax.set_xlabel('Number of Repeated Queries (q)', fontsize=11, labelpad=8)
ax.set_ylabel('Cumulative Cost Savings (ms)', fontsize=11, labelpad=8)
ax.set_xlim(1, MAX_Q)
ax.grid(True, which="major", linestyle=":", alpha=0.4, color="#95a5a6")


ax.legend(fontsize=9.5, loc='lower left', framealpha=0.95, facecolor='white', edgecolor='#e5e5e5')

fig.subplots_adjust(left=0.10, right=0.98, top=0.90, bottom=0.15)
out = HERE / 'rq3_tipping_point.png'
fig.savefig(out, dpi=150)
print(f'Saved {out}')
plt.close()
