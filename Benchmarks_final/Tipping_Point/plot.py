import json, pathlib
import matplotlib
matplotlib.use('Agg')
import pandas as pd
import matplotlib.pyplot as plt
import numpy as np

HERE = pathlib.Path(__file__).parent
raw  = json.loads((HERE / 'rq4_results.json').read_text())
df   = pd.DataFrame(raw['results'])

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

# Accessible Color Mapping
STYLES = {
    'createNT':       {'color': '#0072B2', 'linestyle': '-'},    # Blue
    'dropL':          {'color': '#D55E00', 'linestyle': '-'},    # Vermillion
    'renameL':        {'color': '#009E73', 'linestyle': '-'},    # Bluish Green
    'renamePk':       {'color': '#E69F00', 'linestyle': '-'},    # Orange
    'addLabelToNT':   {'color': '#CC79A7', 'linestyle': '-'},    # Reddish Purple
    'removeProperty': {'color': '#56B4E9', 'linestyle': '-'},    # Sky Blue
    'splitNT':        {'color': '#7B2D8E', 'linestyle': '-'},   # Purple
    'unionNT':        {'color': '#525252', 'linestyle': '-'},   # Dark Gray
}
MAX_Q = 300

f1 = df[df['factor'] == 1].copy()

INF_CAP = 999
f1['tippingPoint'] = f1['tippingPoint'].clip(upper=INF_CAP)

# same size across all plots
fig, ax = plt.subplots(figsize=(10, 6), constrained_layout=True)
fig.patch.set_facecolor('white')
ax.set_facecolor('white')

q_range = np.arange(1, MAX_Q + 1)

for smo in SUBSET:
    sub   = f1[f1['smo'] == smo]
    style = STYLES[smo]

    diffs_all = []
    for _, row in sub.iterrows():
        delta   = row['RQueryMs'] - row['eagerQueryMs']
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
        delta = row['RQueryMs'] - row['eagerQueryMs']
        diffs.append(row['eagerMigrationMs'] - q_range * delta)
    all_medians.append(np.median(diffs, axis=0))
all_medians = np.array(all_medians)
ymin_data = all_medians.min()
ymax_data = all_medians.max()

padding_y_lo = (ymax_data - ymin_data) * 0.12
padding_y_hi = (ymax_data - ymin_data) * 0.65  # extra headroom for legend
ymin = ymin_data - padding_y_lo
ymax = ymax_data + padding_y_hi
ax.set_ylim(ymin, ymax)


ax.set_xlabel('Number of Repeated Queries (q)', fontsize=11, labelpad=8)
ax.set_ylabel('Cumulative Cost Savings (ms)', fontsize=11, labelpad=8)
ax.set_xlim(1, MAX_Q)
ax.grid(True, which="major", linestyle=":", alpha=0.4, color="#95a5a6")


ax.legend(fontsize=9.5, loc='upper left', framealpha=0.95, facecolor='white', edgecolor='#e5e5e5')


out = HERE / 'Tipping_Point.svg'
fig.savefig(out, dpi=300, bbox_inches='tight')
print(f'Saved {out}')
plt.close()
