import {CanvasData, CanvasFileData, AllCanvasNodeData} from 'obsidian/canvas'
import { normalizePath, App, TFile } from 'obsidian'
import {uid} from 'uid'
import IndexPlugin, {ERROR_MESSAGES} from './Plugin'

export const EMPTY_CANVAS = JSON.stringify({nodes:[],edges:[]})

export enum Position {
  TOP_LEFT = 'TOP_LEFT',
  TOP_RIGHT = 'TOP_RIGHT',
  BOTTOM_LEFT = 'BOTTOM_LEFT',
  BOTTOM_RIGHT = 'BOTTOM_RIGHT'
}

/*   nodes.reduce((result,node)=>{
    return[
      node.x + node.width > result[0] ? node.x + node.width : result[0],
      node.x < result[1] ? node.x : result[1],
      node.y > result[2] ? node.y : result[2],
      node.y - node.height < result[3] ? node.y - node.height : result[3]
    ]
  },[0,0,0,0]) */

export default class CanvasUtils{
  app: App
  plugin: IndexPlugin
  constructor(app :App, plugin :IndexPlugin){
    this.app= app
    this.plugin = plugin
  }

  private findBounds = (nodes :AllCanvasNodeData[]) => {
    return {
      x: nodes.length && Math.max(...nodes.map(node=>node.x+node.width)),
      xN: nodes.length && Math.min(...nodes.map(node=>node.x)),
      y: nodes.length && Math.max(...nodes.map(node=>node.y+node.height)),
      yN: nodes.length && Math.min(...nodes.map(node=>node.y))
    }
  }

  addFilesToCanvas = (json :string, paths :string[])=>{
    const NOTE_HEIGHT = this.plugin.settings.canvasSize[0]
    const NOTE_WIDTH = this.plugin.settings.canvasSize[1]
    const GROUP_PAD = 20
    const UPPER_GROUP_PAD = 25
    const INTERVAL = 25
    //console.log('adding to canvas, json:', json)
    const data :CanvasData = JSON.parse(json)
    //console.log('parsed input: ', data)

    const bounds = this.findBounds(data.nodes)
    const totalHeight = NOTE_HEIGHT*paths.length + INTERVAL*(paths.length-1) 
      + (this.plugin.settings.canvasGroup ? GROUP_PAD + UPPER_GROUP_PAD :  0) 

    const x :number = [Position.TOP_LEFT, Position.BOTTOM_LEFT].includes(this.plugin.settings.canvasPosition) ? 
      bounds.xN - NOTE_WIDTH - GROUP_PAD - INTERVAL: // LEFT
      bounds.x + GROUP_PAD + INTERVAL // RIGHT
    let y :number = [Position.TOP_LEFT, Position.TOP_RIGHT].includes(this.plugin.settings.canvasPosition) ? 
      bounds.yN : // TOP
      bounds.y - totalHeight // BOTTOM
    
    if(this.plugin.settings.canvasGroup){
      data.nodes.push({
        type:'group',
        id: uid(16),
        x: x - GROUP_PAD,
        y,
        width: NOTE_WIDTH + GROUP_PAD*2,
        height: totalHeight,
        label: this.plugin.settings.canvasGroupLabel,
        color:'#ff0000'
      })
      y+=UPPER_GROUP_PAD
    }

    paths.forEach(path => {
      //!path.includes('canvas') &&
      data.nodes.push({
        type : 'file',
        id : uid(16),
        x,
        y,
        width : NOTE_WIDTH,
        height : NOTE_HEIGHT,
        file : normalizePath(path)
      })
      y += NOTE_HEIGHT+INTERVAL
    })

    //console.log('output: ', JSON.stringify(data,undefined,2))
    return JSON.stringify(data,undefined,2)
  }

  getLinksFromCanvas = (json :string)=>{
    const data :CanvasData =  JSON.parse(json)
    return data.nodes
      .filter((node):node is CanvasFileData =>node.type=='file')
      .map((node:CanvasFileData)=>normalizePath(node.file))
  }
}
