import Icon from './Icon';
export default function SelectionControl({label,checked,disabled,onChange,children}:{label:string;checked:boolean;disabled?:boolean;onChange:(checked:boolean)=>void;children?:React.ReactNode}) {
  return <label className="selection-control"><input type="checkbox" aria-label={label} checked={checked} disabled={disabled} onChange={event=>onChange(event.target.checked)}/><span className="selection-control-mark" aria-hidden="true"><Icon name={checked?'check':'plus'}/></span>{children&&<span>{children}</span>}</label>;
}
