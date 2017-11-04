import React from 'react';
import './AiCard.css';

class AiCard extends React.Component {
  renderCommand(key, condition, command) {
    return (
      <div key={key}>
        <div className="AiCard-condition">{`${condition}:`}</div>
        <div className="AiCard-command">{command}</div>
      </div>
    );
  }

  render() {
    const baseClass = this.props.elite ? 'AiCardElite' : 'AiCard';

    return (
      <div className={baseClass}>
        <div className={`${baseClass}-header`}>{this.props.name}</div>
        <div className="AiCard-command-container">
          {this.props.commands.map((command, index) =>
            this.renderCommand(`${this.props.name}-${index}`, command.condition, command.command)
          )}
        </div>
      </div>
    );
  }
}

export default AiCard;