export const classname = (classNames: { [key: string]: boolean }, append = '') => Object.keys(classNames).filter(key => classNames[key]).concat(append).join(' ').trim();