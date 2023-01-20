importScripts("https://cdn.jsdelivr.net/pyodide/v0.21.3/full/pyodide.js");

function sendPatch(patch, buffers, msg_id) {
  self.postMessage({
    type: 'patch',
    patch: patch,
    buffers: buffers
  })
}

async function startApplication() {
  console.log("Loading pyodide!");
  self.postMessage({type: 'status', msg: 'Loading pyodide'})
  self.pyodide = await loadPyodide();
  self.pyodide.globals.set("sendPatch", sendPatch);
  console.log("Loaded!");
  await self.pyodide.loadPackage("micropip");
  const env_spec = ['https://cdn.holoviz.org/panel/0.14.1/dist/wheels/bokeh-2.4.3-py3-none-any.whl', 'https://cdn.holoviz.org/panel/0.14.1/dist/wheels/panel-0.14.1-py3-none-any.whl', 'pyodide-http==0.1.0', 'cartopy', 'colorcet', 'holoviews>=1.15.1', 'holoviews>=1.15.1', 'hvplot', 'numpy', 'pandas', 'xarray']
  for (const pkg of env_spec) {
    let pkg_name;
    if (pkg.endsWith('.whl')) {
      pkg_name = pkg.split('/').slice(-1)[0].split('-')[0]
    } else {
      pkg_name = pkg
    }
    self.postMessage({type: 'status', msg: `Installing ${pkg_name}`})
    try {
      await self.pyodide.runPythonAsync(`
        import micropip
        await micropip.install('${pkg}');
      `);
    } catch(e) {
      console.log(e)
      self.postMessage({
	type: 'status',
	msg: `Error while installing ${pkg_name}`
      });
    }
  }
  console.log("Packages loaded!");
  self.postMessage({type: 'status', msg: 'Executing code'})
  const code = `
  
import asyncio

from panel.io.pyodide import init_doc, write_doc

init_doc()


import holoviews as hv
import hvplot
import hvplot.pandas
import hvplot.xarray
import numpy as np
import pandas as pd
import panel as pn
import xarray as xr
import os
from holoviews import opts

new25yAvg = xr.open_dataset(r'C:\\Users\\jafarpurp\\Documents\\X_Python Scripts\\Untitled Folder\\\new_25yrs.nc')
#new25yAvg = new25yAvg['hddheat_18'].rename('25yAvg_hdd')

del new25yAvg.attrs['units']

# # widgets setup

# variable menu
vars = pn.widgets.Select(
    options=[v for v in list(new25yAvg.data_vars.keys()) if "_delta" not in v],
    width=125,
)
vars1 = pn.Column(pn.pane.Markdown("**Select variable**"), vars)

# delta checkbox
delta = pn.widgets.Checkbox(value=False)
delta1 = pn.Column(pn.pane.Markdown("**display deltas**"), delta)

# percentiles menu
perc = pn.widgets.RadioButtonGroup(
    options=list(new25yAvg.percentiles.values), value=50, width=125
)
perc1 = pn.Column(pn.pane.Markdown("**Select ensemble percentile**"), perc)

# horizons menu
hors = pn.widgets.DiscreteSlider(
    options=list(new25yAvg.horizon.values), value="2046-2070", width=200
)
hors1 = pn.Column(pn.pane.Markdown("**Select a 25 year period**"), hors)

# rcps menu
rcps = pn.widgets.RadioButtonGroup(
    options=list(new25yAvg.rcp.values), value="rcp85", width=125
)
rcps1 = pn.Column(pn.pane.Markdown("**Select emissions scenario**"), rcps)

# transparency control
trs = pn.widgets.FloatInput(value=0.8, start=0.0, end=1.0, step=0.2, width=60)
trs1 = pn.Column(pn.pane.Markdown("Opacity"), trs)

# # Dynamically change map using the pn.depends decorator

from bokeh.models import HoverTool
import cartopy.crs as ccrs
import colorcet as cc
from colorcet.plotting import swatch
color_list = ['#c90000', '#faee02', '#00c936', '#0083c9', '#1400c9', '#7f00c9']  #Colors for the map
swatch(name='Legend', cmap=color_list)


@pn.depends( vars.param.value, perc.param.value, hors.param.value, rcps.param.value, trs.param.value, ) 
def plot_map( v=vars.param.value, p=perc.param.value, h=hors.param.value, r=rcps.param.value, alpha=trs.param.value, ):
    out = new25yAvg.swap_dims(dict(time="horizon"))
    #clim = (out[v].min().values, out[v].max().values)
    clim=(2000,8000)
    out = out.sel(percentiles=p, horizon=h, rcp=r)
    show_map = out[v].hvplot(projection=ccrs.Miller(),xlabel="lon",ylabel="lat",clim=clim,cmap=color_list,frame_width=600)
    MyHover = HoverTool(tooltips=[('Heating_Degree_Days','@image{(0000)}')],point_policy="follow_mouse")
    show_map.opts(tools = [MyHover],title="Visualize climate zones shift in Canada")
    return pn.Column(pn.Row(show_map,trs1,),)

pn.Column(pn.Column(vars1, rcps1, perc1, hors1), plot_map).servable()

await write_doc()
  `

  try {
    const [docs_json, render_items, root_ids] = await self.pyodide.runPythonAsync(code)
    self.postMessage({
      type: 'render',
      docs_json: docs_json,
      render_items: render_items,
      root_ids: root_ids
    })
  } catch(e) {
    const traceback = `${e}`
    const tblines = traceback.split('\n')
    self.postMessage({
      type: 'status',
      msg: tblines[tblines.length-2]
    });
    throw e
  }
}

self.onmessage = async (event) => {
  const msg = event.data
  if (msg.type === 'rendered') {
    self.pyodide.runPythonAsync(`
    from panel.io.state import state
    from panel.io.pyodide import _link_docs_worker

    _link_docs_worker(state.curdoc, sendPatch, setter='js')
    `)
  } else if (msg.type === 'patch') {
    self.pyodide.runPythonAsync(`
    import json

    state.curdoc.apply_json_patch(json.loads('${msg.patch}'), setter='js')
    `)
    self.postMessage({type: 'idle'})
  } else if (msg.type === 'location') {
    self.pyodide.runPythonAsync(`
    import json
    from panel.io.state import state
    from panel.util import edit_readonly
    if state.location:
        loc_data = json.loads("""${msg.location}""")
        with edit_readonly(state.location):
            state.location.param.update({
                k: v for k, v in loc_data.items() if k in state.location.param
            })
    `)
  }
}

startApplication()