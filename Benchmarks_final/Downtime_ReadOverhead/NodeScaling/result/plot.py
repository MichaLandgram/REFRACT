import json, pathlib
import pandas as pd
import matplotlib.pyplot as plt
import matplotlib.ticker as mticker

HERE = pathlib.Path(__file__).parent
data = json.loads((HERE / 'node_scaling_results.json').read_text())
data2 = json.loads((HERE / 'schema_scaling_results.json').read_text())
df   = pd.DataFrame(data['results'])
df2  = pd.DataFrame(data2['results'])

# Accessible colour palette
C_REFRACT   = '#1E7EA2'
C_CAMBRIA = '#C09220'
C_EAGER   = '#5B2C82'

SMO_TYPES  = ['renameL', 'removePk', 'splitNT']
SMO_LABELS = {
    'renameL':  'RENAME LABEL',
    'removePk': 'REMOVE PROPERTY',
    'splitNT':  'SPLIT NODE TYPE',
}

def log_formatter(x, pos):
    if x >= 1:
        return f"{int(x)}"
    elif x >= 0.1:
        return f"{x:.1f}"
    else:
        return f"{x:.2f}"

def x_formatter(x, pos):
    if x >= 1000:
        val = x / 1000
        if val.is_integer():
            return f"{int(val)}k"
        else:
            return f"{val:.1f}k"
    return str(int(x))

for smo in SMO_TYPES:
    # same size across all plots
    fig, ax = plt.subplots(figsize=(10, 6), constrained_layout=True)
    fig.patch.set_facecolor('white')
    ax.set_facecolor('white')
    
    sub = df[df['smo'] == smo].sort_values('N')

    ax.plot(sub['N'], sub['lazyReadyMs'],
        's-', color=C_REFRACT, linewidth=2.5, markersize=7,
        markeredgecolor='white', markeredgewidth=1,
        label='REFRACT')


    ax.plot(sub['N'], sub['cambriaReadyMs'],
            '^-', color=C_CAMBRIA, linewidth=2.5, markersize=7,
            markeredgecolor='white', markeredgewidth=1,
            label='Cambria')

    ax.plot(sub['N'], sub['eagerMigrationMs'],
        'o-', color=C_EAGER, linewidth=2.5, markersize=7,
        markeredgecolor='white', markeredgewidth=1,
        label='Eager')

    # ax.set_title(SMO_LABELS[smo], fontsize=12, fontweight='bold', pad=-12)
    ax.text(0.5, 0.98, SMO_LABELS[smo], transform=ax.transAxes,
        fontsize=12, fontweight='bold', color='#333',
        ha='right', va='top',
        bbox=dict(boxstyle='round,pad=0.3', facecolor='white', edgecolor='#ddd', alpha=0.9))


    ax.set_xlabel('Dataset Size (#Person nodes)', fontsize=10.5)
    ax.set_ylabel('Downtime (ms)', fontsize=11)
    
    ax.set_yscale('log')
    ax.yaxis.set_major_formatter(mticker.FuncFormatter(log_formatter))
    ax.xaxis.set_major_formatter(mticker.FuncFormatter(x_formatter))
    ax.grid(True, which="major", linestyle="-", alpha=0.4, color="#ccc")
    ax.grid(True, which="minor", linestyle=":", alpha=0.2, color="#ccc")
    
    ax.legend(loc='upper left', fontsize=10,
              frameon=True, facecolor='white', edgecolor='#e5e5e5')


    out_name = f'downtime_node_{smo}.svg'
    fig.savefig(HERE / out_name, dpi=300, bbox_inches='tight')
    print(f'Saved {out_name}')
    plt.close()


for smo in SMO_TYPES:
    # same size across all plots
    fig, ax = plt.subplots(figsize=(10, 6), constrained_layout=True)
    fig.patch.set_facecolor('white')
    ax.set_facecolor('white')
    
    sub = df2[df2['smo'] == smo].sort_values('N')

    ax.plot(sub['N'], sub['lazyReadyMs'],
        's-', color=C_REFRACT, linewidth=2.5, markersize=7,
        markeredgecolor='white', markeredgewidth=1,
        label='REFRACT')

    ax.plot(sub['N'], sub['cambriaReadyMs'],
            '^-', color=C_CAMBRIA, linewidth=2.5, markersize=7,
            markeredgecolor='white', markeredgewidth=1,
            label='Cambria')

    ax.plot(sub['N'], sub['eagerMigrationMs'],
            'o-', color=C_EAGER, linewidth=2.5, markersize=7,
            markeredgecolor='white', markeredgewidth=1,
            label='Eager')


    # ax.set_title(SMO_LABELS[smo], fontsize=12, fontweight='bold', pad=12) for paper style
    ax.text(0.5, 0.98, SMO_LABELS[smo], transform=ax.transAxes,
    fontsize=12, fontweight='bold', color='#333',
    ha='right', va='top',
    bbox=dict(boxstyle='round,pad=0.3', facecolor='white', edgecolor='#ddd', alpha=0.9))
    ax.set_xlabel('Schema Size (#Types)', fontsize=10.5)
    ax.set_ylabel('Downtime (ms)', fontsize=11)
    
    ax.set_yscale('log')
    ax.yaxis.set_major_formatter(mticker.FuncFormatter(log_formatter))
    ax.xaxis.set_major_formatter(mticker.FuncFormatter(x_formatter))
    ax.grid(True, which="major", linestyle="-", alpha=0.4, color="#ccc")
    ax.grid(True, which="minor", linestyle=":", alpha=0.2, color="#ccc")
    
    ax.legend(loc='upper left', fontsize=10,
              frameon=True, facecolor='white', edgecolor='#e5e5e5')


    out_name = f'downtime_schema_{smo}.svg'
    fig.savefig(HERE / out_name, dpi=300, bbox_inches='tight')
    print(f'Saved {out_name}')
    plt.close()

